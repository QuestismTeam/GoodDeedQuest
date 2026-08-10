import logging
from typing import Dict, Any, List, Final

import httpx
import openai
from pydantic import BaseModel, Field
from langchain_core.exceptions import OutputParserException
from langchain_core.prompts import ChatPromptTemplate

from ai.app.common.llm import get_openai_model, invoke_gemini_fallback
from ai.app.quest_recommend.state import RecommendState


logger: Final = logging.getLogger(__name__)

class PlannerOutput(BaseModel):
    """유저 프로필과 실시간 기상/요일 상황을 융합 분석하여 도출한 추천 전략 및 쿼리 정보를 담는 Pydantic 스키마"""
    strategy: str = Field(
        ...,
        # "추천 방향을 설명하는 간략한 전략 요약 (예: '비 오는 평일이므로 실내 환경 관련 활동을 강조')."
        description="A brief strategy summary explaining the recommendation direction (e.g. 'Emphasize indoor environmental tasks on rainy weekdays')."
    )
    search_query: str = Field(
        ...,
        # "벡터 데이터베이스에서 관련 봉사 활동을 찾기 위해 최적화된 검색 쿼리 키워드 (예: '실내 환경 교육')."
        description="An optimized search query keyword to find relevant volunteer tasks from the vector database (e.g., 'indoor environmental education')."
    )
    llm_constraints: List[str] = Field(
        ...,
        # "퀘스트가 이 사용자에게 맞는지 판정할 때 쓰는 2~4개의 조건 목록 (예: '사용자의 관심사나 요청 주제와 관련이 있어야 함', '레벨 1이 부담 없이 할 수 있어야 함'). 각 조건은 '수행할 명령'이 아니라 '확인할 속성' 형태로 작성."
        # ⭐ 수정: 조건 개수를 2~4개에서 최대 2개로 줄이고, '초점' 대신 '관련'으로 쓰도록 지시.
        # "퀘스트가 이 사용자에게 맞는지 판정할 때 쓰는 최대 2개의 넓은 조건.
        #  '~에 초점을 맞춰야 한다'가 아니라 '~와 관련이 있으면 된다' 형태로 쓴다."
        description="At most 2 broad conditions used to judge whether a quest fits this user. Phrase each as 'relates to X', never as 'focuses on X'. Write them as properties to check, not as orders to carry out."
    )

def analyze_strategy(state: RecommendState) -> Dict[str, Any]:
    """
    사용자 프로필(user_profile), 주변 상황(situation_context), 유저 요구사항(request_context)을 통합 분석하여
    추천 전략 및 벡터 DB 검색용 쿼리를 수립하는 LangGraph 노드 함수입니다.
    Critic 비평가의 반려 사유(rejection_reasons) 피드백이 존재할 경우 전략과 쿼리를 스마트하게 보정합니다.
    """
    user_profile = state.get("user_profile", {})
    situation_context = state.get("situation_context", {})
    request_context = state.get("request_context", {})
    retry_count = state.get("retry_count", 0)
    rejection_reasons_en = state.get("rejection_reasons_en", [])

    model_name = "gpt-4o" if rejection_reasons_en else "gpt-4o-mini"

    # Critic 반려 사유 피드백 지침 구성
    rejection_feedback = ""
    if rejection_reasons_en:
        logger.info(f"Critic 반려 피드백 수용 전략 보정 가동 (반려 건수: {len(rejection_reasons_en)}건)")
        # \n- 치명적 반려 피드백: 이전 퀘스트 후보들이 다음 이유로 반려되었습니다: {rejection_reasons}. 이 반려 사유들을 극복할 수 있도록 search_query와 llm_constraints를 엄격하게 보정하십시오!
         # ⭐ 수정: 기존 문구는 "조건을 더 엄격하게 보정하라"였는데, 실측 로그에서 반려의 대부분이
        # '조건이 너무 좁아서' 생긴 것이었다. 엄격하게 만들라고 시키면 다음 회차에 더 많이 반려된다.
        # 반려가 났다는 건 조건이 좁았다는 신호이므로 넓히는 방향으로 지시한다.
        rejection_feedback = (
            f"\n- REJECTION FEEDBACK: In the previous round these candidates were rejected: {rejection_reasons_en}. "
            "Rejections almost always mean YOUR conditions were too narrow, not that the candidates were bad. "
            "Rewrite 'llm_constraints' WIDER — drop the condition that caused the rejections, or restate it as a broader 'relates to' condition. "
            "Do not add new conditions. Widen the search_query instead of narrowing it."
        )

    """
    ("system", "당신은 전문 퀘스트 추천 플래너입니다. 사용자의 정보를 분석하여 추천 전략을 수립하세요.
        입력된 정보를 바탕으로 다음 내용을 포함한 PlannerOutput을 생성하세요.
        - 'strategy': 사용자의 관심사와 요청 내용을 기반으로 한 전체 추천 방향
        - 'search_query': 벡터 데이터베이스에서 가장 적합한 봉사활동을 찾기 위한 최적화된 검색 키워드
        - 'llm_constraints': 해당 퀘스트가 사용자에게 적합한지 판단하기 위한 조건 2~4개
        - 'llm_constraints': 해당 퀘스트가 사용자에게 적합한지 판단하기 위한 조건 2~4개

        사용자 관심사 코드는 다음 6종뿐이며 각각의 범위는 아래와 같습니다.
        - volunteer: 봉사활동 전반
        - environment: 환경 정화, 재활용, 자원 절약, 기후 대응
        - sharing: 기부, 물품 나눔, 식사 나눔
        - animal: 유기동물 보호, 동물 돌봄
        - community: 이웃 돕기, 지역 행사, 그리고 노인·장애인·아동·저소득층·다문화 가정 등 지역 주민을 돕는 활동을 모두 포함합니다.
        - other: 위에 속하지 않는 선행

        'llm_constraints' 작성 방법 — 가장 오류가 많이 발생하는 부분이므로 반드시 숙지하세요.
        
        (a) 이 조건들은 두 가지 용도로 모두 사용됩니다.
        - AI가 새로운 일일 선행 퀘스트를 생성할 때의 가이드
        - 이미 존재하는 실제 봉사활동 공고를 평가하는 기준
        실제 봉사 공고는 일정, 대상, 장소 등이 이미 정해져 있어 수정할 수 없습니다.
        따라서 작성하는 모든 조건은 실제 공고도 만족할 수 있을 만큼 현실적이고 충분히 넓은 범위여야 합니다.
        (b) 조건은 '수행해야 할 명령'이 아니라 '확인해야 할 속성' 형태로 작성해야 합니다.
        예를 들어,
        - "퀘스트 주제는 청소년 또는 지역사회와 관련되어야 한다." (O)
        - "청소년과 함께 활동해야 한다." (X)
        명령문 형태로 작성하면 실제 봉사 공고가 불필요하게 탈락하는 원인이 됩니다.
        (c) 조건은 반드시 사용자가 실제로 요청한 내용에서만 도출해야 합니다.
        사용자의 관심사나 요청 의도만 조건으로 사용할 수 있습니다.
        상황 정보(날씨, 평일/주말, 날짜, 사용자 레벨)는 단순한 환경 정보일 뿐이며, 절대로 조건으로 바꾸면 안 됩니다.
        예를 들어,
        - is_outdoor_feasible=true
        → 야외 활동이 가능하다는 의미일 뿐, 야외 활동을 반드시 해야 한다는 뜻이 아닙니다.
        → 실내/실외 조건을 추가하지 마세요.
        - is_weekend=true
        → 오늘이 주말이라는 의미일 뿐, 주말 활동만 허용하는 조건을 만들면 안 됩니다.
        - 사용자 레벨이 낮음
        → 초보 사용자라는 의미일 뿐, 난이도 조건을 추가하면 안 됩니다.
        유일한 예외:
        - is_outdoor_feasible=False (비 또는 눈)
        → 안전을 위해 '실내 활동' 조건을 반드시 추가해야 합니다.
        (d) request_context.indoor_outdoor_preference에
        'indoor' 또는 'outdoor'가 명시되어 있다면,
        이는 사용자의 명시적인 요청이므로 해당 조건을 추가할 수 있습니다.
        항상 실제 봉사 공고도 만족할 수 있도록,
        조건은 너무 좁거나 과도하게 제한적이지 않게 작성하세요.{rejection_feedback}"),
    ("human", ("### 입력 정보
        1. 사용자 프로필: {user_profile}
        2. 상황 컨텍스트 (날짜, 평일/주말, 날씨, 야외 활동 가능 여부): {situation_context}
        3. 사용자 커스텀 요청 컨텍스트: {request_context}"))
    """
    planner_prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a professional Quest Recommendation Planner. Analyze the user's information and plan a recommendation strategy.
Based on the inputs, construct a detailed PlannerOutput specifying:
- 'strategy': The overall direction, grounded in the user's interests and their custom request context.
- 'search_query': An optimized search query keyword to find the most relevant volunteer tasks from the vector database.
- 'llm_constraints': 2 to 4 conditions used to judge whether a quest fits this user.
The user's interest codes are limited to these six. Each covers the following:
- volunteer: volunteer work in general
- environment: cleanups, recycling, resource saving, climate action
- sharing: donations, sharing goods, sharing meals
- animal: rescued animal care, animal welfare
- community: helping neighbours and local events, AND support for elderly people, people with disabilities, children, low-income households and multicultural families. Supporting a daycare, a public library, a welfare centre or a community centre all count as COMMUNITY.
- other: good deeds that fit none of the above
HOW TO WRITE 'llm_constraints' — read carefully, this is the most error-prone part:
(a) These conditions are applied twice: once as guidance when generating new AI daily good deed quests, and once as scoring criteria for real, already-published volunteer listings that cannot be rewritten. A real listing has a fixed schedule, a fixed audience and a fixed venue, so any condition you invent becomes a hard gate it may be unable to pass.
(b) Write each condition as a property to check, not as an order to carry out. Write "the quest topic must relate to youth or the local community", not "engage youth in activities" — an order gets misread as a requirement about who performs the activity, and real listings get rejected for no good reason.
(c) Only derive a condition from something the user actually asked for — their interests, or the intent of their request message. The situation context (weather, weekday/weekend, date, user level) describes circumstances, NOT requirements. Never convert a circumstance into a requirement:
  - is_outdoor_feasible=true means outdoor is possible, NOT that outdoor is required. Add no indoor/outdoor condition.
  - is_weekend=true means today happens to be a weekend, NOT that the user demands a weekend-only activity. Never add a scheduling or day-of-week condition based on it.
  - A low user level means the user is new, NOT that difficult quests must be rejected. Never add a condition that gates on level or difficulty.
  The only exception: if is_outdoor_feasible is False (rain or snow), an indoor-only condition IS required for safety.
(d) If request_context.indoor_outdoor_preference explicitly says 'indoor' or 'outdoor', you may add the matching condition — that one came from the user.
Keep the conditions broad enough that a genuinely relevant real-world volunteer listing can satisfy them.{rejection_feedback}"""),
        ("human", """### Input Information
1. User Profile: {user_profile}
2. Situation Context (Date, Weekday/Weekend, Weather, Outdoor Feasibility): {situation_context}
3. Custom User Request Context: {request_context}""")
    ])

    input_data = {
        "user_profile": user_profile,
        "situation_context": situation_context,
        "request_context": request_context,
        "rejection_feedback": rejection_feedback
    }

    response = None
    try:
        # 1. 정상 연산: OpenAI 모델 호출
        llm = get_openai_model(model_name=model_name, temperature=0.2)  # 전략적 추론을 위해 온도=0.2
        structured_llm = llm.with_structured_output(PlannerOutput)

        planner_chain = planner_prompt | structured_llm
        response = planner_chain.invoke(input_data)

    except (openai.OpenAIError, OutputParserException, httpx.HTTPError) as e:
        # 2. OpenAI 장애 발생 시 Gemini 백업 함수 호출
        logger.warning(f"OpenAI 전략 수립 중 예외 발생 ({e}). Gemini 백업 모델을 가동합니다.")
        response = invoke_gemini_fallback(
            prompt=planner_prompt,
            input_data=input_data,
            structured_schema=PlannerOutput,
            temperature=0.2
        )
    except Exception as e:
        logger.error(f"전략 수립 중 비정상 예외 발생: {e}")

    # 3. 정상 반환 (OpenAI 또는 Gemini 성공 시)
    if response:
        strategy_dict = response.model_dump()
        # ⭐ 수정: 어떤 조건이 걸렸는지 로그로 남긴다. 봉사 반려가 터졌을 때
        # 반려 사유만 보고는 어떤 조건이 원인인지 알 수 없어 추적이 어려웠다.
        logger.info(
            f"추천 전략 수립 완료. 검색어: '{strategy_dict.get('search_query')}', "
            f"조건: {strategy_dict.get('llm_constraints')}"
        )
        new_retry = retry_count + 1 if state.get("recommendation_strategy") else retry_count
        return {
            "recommendation_strategy": strategy_dict,
            "retry_count": new_retry
        }
    
    # 4. 양대 LLM 모두 실패 시 안전 기본 전략 반환 (Defensive Fallback)
    logger.warning("양대 LLM 모두 실패. 사용자 관심 기반 안전 기본 전략으로 방어합니다.")
    interests = user_profile.get("interests", [])
    fallback_query = ", ".join(interests) if interests else "volunteer"
    
    return {
        "recommendation_strategy": {
            "strategy": "Recommend standard quests based on user interests.",
            "search_query": fallback_query,
            "llm_constraints": []
        }
    }


def route_after_planner(state: RecommendState) -> List[str]:
    """
    Planner 수립 직후 병렬 실행할 노드를 결정하는 라우터 함수입니다.
    이전 회차에서 '주변 봉사 데이터 없음'이 확정(skip_volunteer_agent=True)된 경우,
    결과가 동일할 것이 확실한 봉사 수색을 건너뛰고 일상 선행 생성만 수행합니다.
    """
    skip_volunteer_agent = state.get("skip_volunteer_agent", False)

    if skip_volunteer_agent:
        logger.info("주변 봉사 데이터 없음이 확정되어 봉사 수색 노드를 건너뛰고 일상 선행만 재생성합니다.")
        return ["good_deed"]

    return ["volunteer", "good_deed"]

