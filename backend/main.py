
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.app.common.config import get_setting
from backend.app.common.s3_client import forget_request_host, remember_request_host
# 라우터 임포트
from backend.app.auth.router import router as auth_router
from backend.app.quest.router import router as quest_router
from backend.app.quest_recommend.router import router as recommend_router
from backend.app.quest_verification.router import router as verification_router
from backend.app.challenge.router import router as challenge_router
from backend.app.community.router import router as community_router
from backend.app.short_form.router import router as shorts_router
from backend.app.background_music.router import router as background_music_router
from backend.app.map.router import router as map_router
from backend.app.growth.router import router as growth_router
# from backend.app.notification.router import router as notification_router  # TODO: notification 모듈 아직 없음
from backend.app.admin.router import router as admin_router
from backend.app.shop.router import router as shop_router
from backend.app.badge.router import router as badge_router
from backend.app.mypage.router import router as mypage_router  # ⭐ 수정
import backend.app.models_registry  # noqa: F401  # 모든 도메인 모델을 한 번에 등록 (relationship/ForeignKey 문자열 참조 해석용)

app = FastAPI(
    title=get_setting().PROJECT_NAME,
    description="Good Deed Quest (선행퀘스트) 메인 백엔드 API 서버",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발용. 실배포 시 구체적인 프론트엔드 도메인 지정
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 【2026-11 로컬 전환】 앱이 접속한 주소를 기억해 둔다.
# 로컬 S3 의 presigned URL 을 그 주소로 서명하기 위해서다 (s3_client._client_facing_endpoint).
# AWS S3 를 쓸 때는 기억만 하고 쓰이지 않는다.
@app.middleware("http")
async def remember_host_for_presigned_url(request: Request, call_next):
    token = remember_request_host(request.url.hostname)
    try:
        return await call_next(request)
    finally:
        forget_request_host(token)

static_dir = os.path.join(os.path.dirname(__file__), "app", "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# API v1 라우터 등록
api_prefix = get_setting().API_V1_STR
app.include_router(auth_router, prefix=api_prefix)
app.include_router(quest_router, prefix=api_prefix)
app.include_router(recommend_router, prefix=api_prefix)
app.include_router(verification_router, prefix=api_prefix)
app.include_router(challenge_router, prefix=api_prefix)
app.include_router(community_router, prefix=api_prefix)
app.include_router(shorts_router, prefix=api_prefix)
app.include_router(background_music_router, prefix=api_prefix)
app.include_router(map_router, prefix=api_prefix)
app.include_router(growth_router, prefix=api_prefix)
# app.include_router(notification_router, prefix=api_prefix)  # TODO: notification 모듈 아직 없음
app.include_router(admin_router, prefix=api_prefix)
app.include_router(shop_router, prefix=api_prefix)
app.include_router(badge_router, prefix=api_prefix)
app.include_router(mypage_router, prefix=api_prefix)  # ⭐ 수정

@app.get("/")
def home():
    return {
        "status": "online",
        "project": get_setting().PROJECT_NAME,
        "docs": "/docs",
        "description": "작은 선행을 퀘스트로 - AI 기반 공익 플랫폼 Good Deed Quest"
    }

if __name__ == "__main__":
    import uvicorn
    # uvicorn 실행 (개발 시 python -m backend.main 로 기동)
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
