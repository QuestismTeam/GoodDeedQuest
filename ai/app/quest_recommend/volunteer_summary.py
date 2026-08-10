import logging
import re
from typing import Dict, Any, List, Final

import httpx
import openai
from pydantic import BaseModel, Field
from langchain_core.exceptions import OutputParserException
from langchain_core.prompts import ChatPromptTemplate

from ai.app.common.llm import get_openai_model, invoke_gemini_fallback


logger: Final = logging.getLogger(__name__)

SUMMARY_SOURCE_MAX_CHARS: Final = 600

TITLE_MAX_CHARS: Final = 200
SUMMARY_MAX_CHARS: Final = 300

DECORATION_PATTERN: Final = re.compile(r"[★☆■□▶▷◆◇●○♥♡◎▲△▼▽※〓]+")
BRACKET_TAG_PATTERN: Final = re.compile(r"\[[^\]]{1,30}\]")
DATE_PAREN_PATTERN: Final = re.compile(r"\(\s*\d{1,2}\s*[/.\-]\s*\d{1,2}[^)]*\)")
TRAILING_RECRUIT_PATTERN: Final = re.compile(
    r"(?:\s*\d+\s*차)?\s*(?:상시|추가|긴급|정기)?\s*"
    r"(?:모집합니다|모집해요|모집중|모집공고|모집|모십니다)\s*[.!~]*\s*$"
)
MULTI_SPACE_PATTERN: Final = re.compile(r"\s+")


class VolunteerSummaryItem(BaseModel):
    center_id: int = Field(
        ...,
        description="The center_id of the posting being summarized. Copy the number from the input exactly."
    )
    quest_title: str = Field(
        ...,
        description="A short quest title shown in the app, in Korean, 25 characters or fewer."
    )
    quest_summary: str = Field(
        ...,
        description="A one-sentence summary of the activity, in Korean, around 60 characters."
    )

class VolunteerSummaryOutput(BaseModel):
    summaries: List[VolunteerSummaryItem] = Field(
        default_factory=list,
        description="Conversion results for every posting in the input."
    )

def clean_raw_title(title: str) -> str:
    if not title or not title.strip():
        return "봉사활동"

    original = title.strip()
    cleaned = DECORATION_PATTERN.sub(" ", original)
    cleaned = BRACKET_TAG_PATTERN.sub(" ", cleaned)
    cleaned = DATE_PAREN_PATTERN.sub(" ", cleaned)
    cleaned = TRAILING_RECRUIT_PATTERN.sub("", cleaned)
    cleaned = MULTI_SPACE_PATTERN.sub(" ", cleaned).strip()

    return cleaned or original

def build_fallback_summary(center: Dict[str, Any]) -> tuple[str, str]:
    quest_title = clean_raw_title(center.get("vol_title"))

    organization = (center.get("vol_name") or "").strip()
    target = (center.get("target") or "").strip() or "지역 주민"

    if organization:
        quest_summary = f"{organization}에서 {target} 대상으로 진행하는 봉사활동입니다."
    else:
        quest_summary = f"{target} 대상으로 진행하는 봉사활동입니다."

    return quest_title, quest_summary

def generate_volunteer_summaries(centers: List[Dict[str, Any]]) -> Dict[int, tuple[str, str]]:
    if not centers:
        return {}

    posting_blocks = []
    for center in centers:
        raw_act = (center.get("vol_act") or "").strip()
        if len(raw_act) > SUMMARY_SOURCE_MAX_CHARS:
            raw_act = raw_act[:SUMMARY_SOURCE_MAX_CHARS]

        posting_blocks.append(
            f"center_id: {center.get('center_id')}\n"
            f"제목: {clean_raw_title(center.get('vol_title'))}\n"
            f"기관: {center.get('vol_name') or '기관명 없음'}\n"
            f"대상: {center.get('target') or '지역 주민'}\n"
            f"상세: {raw_act or '상세 내용 없음'}"
        )

    """
    ("system", "당신은 크롤링된 봉사 공고를 모바일 앱에 표시할 짧은 퀘스트로 다듬는 편집자입니다.
        입력된 각 공고마다 세 개의 필드를 가진 객체를 하나씩 반환하십시오.
        - 'center_id': 입력받은 숫자를 그대로 복사하십시오. 결과를 원본과 대응시키는 유일한 기준입니다.
        - 'quest_title': 한국어 제목, 25자 이내.
        - 'quest_summary': 한국어 한 문장, 60자 내외.
        ### 제목 규칙
        - 무슨 활동인지가 드러나야 합니다.
        - 장식문자, 대괄호 기관 표기, 날짜, '모집'·'상시'·'2차' 같은 군더더기는 넣지 마십시오.
        - 기관명은 넣지 마십시오. 화면에 별도로 표시됩니다.
        ### 요약 규칙
        - 정확히 한 문장이며 '봉사입니다.' 또는 '봉사활동입니다.'로 끝내십시오.
        - 누구를 대상으로 무엇을 하는 활동인지 서술하십시오.
        - 원문에 없는 내용을 절대 만들어내지 마십시오. 사용자가 실제로 찾아가는 봉사입니다.
        - 전화번호, 이메일, 신청 방법, 혜택, 식사·간식 제공, 제출 서류, 모집 인원은 넣지 마십시오. 원문 전체를 보여주는 별도 화면이 있습니다.
        - 원문에 활동 내용이 없으면 기관 성격과 대상만으로 일반적으로 서술하십시오.
        입력된 공고 수만큼 정확히 반환하고 하나도 빠뜨리지 마십시오."),
    ("human", "### 봉사 공고 목록
        {volunteer_postings}")
    """
    summary_prompt = ChatPromptTemplate.from_messages([
        ("system", """You are an editor who turns raw crawled volunteer postings into short quest entries for a mobile app.
For EACH posting in the input, return one object with three fields:
- 'center_id': copy the number from the input exactly. This is the only key used to match results back to the source.
- 'quest_title': a Korean title, 25 characters or fewer.
- 'quest_summary': one Korean sentence, around 60 characters.
### Title Rules
- Make it clear what the activity actually is.
- Do not include decorative characters, bracketed organization tags, dates, or filler words like '모집', '상시', '2차'.
- Do not include the organization name — it is displayed separately on screen.
### Summary Rules
- Exactly one sentence in Korean, ending with '봉사입니다.' or '봉사활동입니다.'
- State who is helped and what is done.
- NEVER invent details that are not in the source. This is a real posting the user will physically attend.
- Do NOT include phone numbers, emails, application methods, benefits, meal or snack provision, required documents, or recruitment headcount. A separate screen shows the full original posting.
- If the source does not state what the activity is, describe it generally from the organization type and the target group.
Return exactly one object per input posting. Do not skip any."""),
        ("human", """### 봉사 공고 목록
{volunteer_postings}""")
    ])

    input_data = {
        "volunteer_postings": "\n\n".join(posting_blocks)
    }

    response = None
    try:
        llm = get_openai_model(model_name="gpt-4o-mini", temperature=0.3)
        structured_llm = llm.with_structured_output(VolunteerSummaryOutput)

        summary_chain = summary_prompt | structured_llm
        response = summary_chain.invoke(input_data)

    except (openai.OpenAIError, OutputParserException, httpx.HTTPError) as e:
        logger.warning(f"OpenAI 봉사 공고 요약 중 예외 발생 ({e}). Gemini 백업 모델을 가동합니다.")
        response = invoke_gemini_fallback(
            prompt=summary_prompt,
            input_data=input_data,
            structured_schema=VolunteerSummaryOutput,
            temperature=0.3
        )
    except Exception as e:
        logger.error(f"봉사 공고 요약 중 비정상 예외 발생: {e}")

    summaries: Dict[int, tuple[str, str]] = {}
    if response and response.summaries:
        for item in response.summaries:
            quest_title = (item.quest_title or "").strip()
            quest_summary = (item.quest_summary or "").strip()
            if quest_title and quest_summary:
                summaries[item.center_id] = (
                    quest_title[:TITLE_MAX_CHARS],
                    quest_summary[:SUMMARY_MAX_CHARS]
                )

    fallback_count = 0
    for center in centers:
        center_id = center.get("center_id")
        if center_id not in summaries:
            summaries[center_id] = build_fallback_summary(center)
            fallback_count += 1

    logger.info(
        f"봉사 공고 요약 생성 완료. 요청 {len(centers)}건 / "
        f"LLM 처리 {len(centers) - fallback_count}건 / 규칙 폴백 {fallback_count}건"
    )
    return summaries