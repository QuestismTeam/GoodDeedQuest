"""
short_form AI 파이프라인 LangGraph 뼈대

흐름:
Vision Agent -> RAG Agent -> LLM Story Agent -> Validation Agent -> FFmpeg Render Agent

Validation 실패 시 Render 단계로 안 넘어가고 그대로 종료 (status=FAILED).
각 Agent(vision/rag/llm_story/validation/render)는 전부 실제 로직으로 구현되어 있음.
"""
from langgraph.graph import StateGraph, END
# StateGraph: LangGraph의 핵심 클래스. "어떤 State 타입을 쓸지"를 지정해서
#             그래프(노드+엣지)를 만드는 빌더 역할을 함.
# END: 그래프의 종료 지점을 나타내는 특수 상수. 이 노드로 가면 파이프라인이 끝남.

from .state import ShortFormState
from .agents.vision_agent import vision_agent
from .agents.rag_agent import rag_agent
from .agents.llm_story_agent import llm_story_agent
from .agents.validation_agent import validation_agent
from .agents.render_agent import render_agent
# 각 Agent 파일에서 함수 하나씩만 가져옴.
# 이 함수들은 전부 "State를 받아서 -> 일부 필드를 채운 State를 리턴"하는 동일한 시그니처를 가짐.
# LangGraph 노드로 등록하려면 이 규칙(State in -> State out)을 지켜야 함.

# 검증 통과 여부에 따라 다음에 어느 노드로 갈지 정하는 라우팅 함수
def route_after_validation(state: ShortFormState) -> str:
    """검증 통과 여부에 따라 다음에 어느 노드로 갈지 정하는 라우팅 함수.

    LangGraph의 조건부 엣지(conditional edge)는 이런 함수를 하나 받아서,
    이 함수가 리턴하는 문자열 키에 매칭되는 노드로 다음 실행을 넘김.
    (아래 add_conditional_edges의 3번째 인자 dict가 "키 -> 실제 노드" 매핑)
    """
    if state["validation_passed"]:
        return "render"   # 검증 통과 -> render 노드로 이동
    return "end"           # 검증 실패 -> END로 이동 (파이프라인 종료)


# vision 다음에 rag를 실행할지 스킵할지 정하는 라우팅 함수
def route_after_vision(state: ShortFormState) -> str:
    """
    router.py가 호출 전에 이미 bgm_match를 채워서 넘겼으면(=backend가 이미 확정한 BGM이
    있으면) rag_agent를 건너뛰고 그 값을 그대로 쓴다. bgm_match가 비어있으면(자동 생성
    경로 등) 기존처럼 rag_agent가 vision 결과로 자동 매칭하게 둔다.

    rag_agent 자체는 수정하지 않고, 그래프 흐름(엣지)만 조건부로 바꾼다.
    """
    if state.get("bgm_match"):
        return "skip_rag"
    return "run_rag"


def build_shortform_graph():
    """그래프를 조립하고 실행 가능한 형태로 컴파일해서 리턴하는 함수"""

    graph = StateGraph(ShortFormState)
    # 이 그래프가 다룰 State의 "모양"이 ShortFormState라고 지정.
    # LangGraph가 내부적으로 이 TypedDict의 필드들을 보고 State를 관리함.

    # ── 노드 등록: "노드 이름" -> 실제로 실행할 함수 ─────────────
    graph.add_node("vision", vision_agent)
    graph.add_node("rag", rag_agent)
    graph.add_node("llm_story", llm_story_agent)
    graph.add_node("validation", validation_agent)
    graph.add_node("render", render_agent)
    # 여기서 등록한 "vision", "rag" 같은 문자열이 노드의 이름(id)이 되고,
    # 아래 add_edge에서 이 이름으로 노드 간 연결을 정의함.

    graph.set_entry_point("vision")
    # 파이프라인이 시작될 때 제일 먼저 실행될 노드를 지정. (Vision Agent부터 시작)

    # ── 단순 순차 연결 (조건 없이 무조건 다음 노드로) ────────────
    # ⭐ 수정: vision -> rag 고정 엣지를 조건부 엣지로 교체 (BGM 재매칭 덮어쓰기 버그 수정)
    # bgm_match가 이미 채워져 들어오면(backend가 확정한 BGM) rag를 건너뛰고 곧장 llm_story로.
    graph.add_conditional_edges(
        "vision",
        route_after_vision,
        {"run_rag": "rag", "skip_rag": "llm_story"},
    )
    graph.add_edge("rag", "llm_story")        # rag 끝나면 -> llm_story 실행
    graph.add_edge("llm_story", "validation") # llm_story 끝나면 -> validation 실행

    # ── 조건부 연결 (validation 결과에 따라 분기) ────────────────
    graph.add_conditional_edges(
        "validation",              # 이 노드가 끝난 뒤에
        route_after_validation,    # 이 함수를 호출해서 (State를 넘겨줌)
        {"render": "render", "end": END},
        # 함수가 "render"를 리턴하면 -> render 노드로, "end"를 리턴하면 -> END로 이동
    )

    graph.add_edge("render", END)
    # render 노드가 끝나면 무조건 파이프라인 종료

    return graph.compile()
    # compile()을 호출해야 실제로 .invoke()로 실행 가능한 객체가 됨.
    # (그냥 StateGraph 객체 상태로는 실행 불가, 반드시 컴파일 필요)


def run_shortform_pipeline(initial_state: ShortFormState) -> ShortFormState:
    """service.py / tasks.py에서 이 함수를 호출해서 파이프라인을 실행하게 됨.

    Celery task(render_shortform_task) 안에서 이 함수를 부르는 형태가 될 예정.
    """
    app = build_shortform_graph()
    result = app.invoke(initial_state)
    # invoke(): 컴파일된 그래프에 초기 State를 넣고 entry_point부터 END까지
    #           순서대로 실행. 최종적으로 마지막 노드가 리턴한 State를 돌려줌.
    return result


if __name__ == "__main__":
    # 이 파일을 직접 실행했을 때만 동작하는 코드 (다른 파일에서 import할 때는 실행 안 됨)
    # `python -m short_form.graph` 로 실행하면 여기로 진입해서 더미 데이터로 테스트 가능.

    dummy_initial_state: ShortFormState = {
        "shorts_id": 1,
        "user_name": "홍길동",
        "quest_title": "플로깅(조깅하며 쓰레기 줍기)",
        "media_keys": ["test-images/test1.png"],
        "edited_captions": None,       # None이라 LLM Story Agent가 자막을 새로 생성하게 됨
        "vision_results": [],          # 아직 Vision Agent가 안 돌았으니 빈 값으로 시작
        "bgm_match": None,             # 아직 RAG Agent가 안 돌았으니 빈 값
        "generated_captions": [],
        "validation_passed": False,
        "validation_errors": [],
        "rendered_video_key": None,
        "status": "GENERATING",        # 파이프라인이 시작되면 보통 GENERATING 상태로 넘어옴
        "error_message": None,
    }

    final_state = run_shortform_pipeline(dummy_initial_state)
    print("\n=== FINAL STATE ===")
    print(final_state)
    # 여기서 vision_results, bgm_match, generated_captions, rendered_video_key,
    # status가 전부 채워진 최종 State가 출력되면 그래프가 정상 동작한 것.