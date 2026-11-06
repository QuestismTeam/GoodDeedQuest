import os
from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

ROOT_DIR = Path(__file__).resolve().parents[3]
load_dotenv(ROOT_DIR / ".env")

class AISettings(BaseSettings):
    PROJECT_NAME: str = "Good Deed Quest AI Service"

    # Database (backend와 동일한 루트 .env를 공유하므로 별도 값 세팅 불필요)
    DATABASE_URL: str

    # OpenAI & Gemini keys
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    
    # Model configs
    DEFAULT_LLM_MODEL: str = os.getenv("DEFAULT_LLM_MODEL", "gpt-4o")
    DEFAULT_VISION_MODEL: str = os.getenv("DEFAULT_VISION_MODEL", "gemini-2.5-flash")
    DEFAULT_STORY_MODEL: str = os.getenv("DEFAULT_STORY_MODEL", "gpt-4o-mini")

    # Validation configs
    MAX_CAPTION_LENGTH: int = int(os.getenv("MAX_CAPTION_LENGTH", "30"))

    # ⭐ 신규: FFmpeg Render Agent 자막 폰트 경로 (OS별로 다름)
    # 기본값은 로컬 Windows 개발 환경 경로. Docker(Linux) 배포 시에는 환경변수로
    # /usr/share/fonts/truetype/nanum/NanumGothic.ttf를 주입한다 (ai/Dockerfile에 fonts-nanum 설치됨).
    FONT_PATH: str = os.getenv("FONT_PATH", r"C:\Windows\Fonts\malgun.ttf")

    # AWS / S3 (backend와 동일한 루트 .env를 공유)
    AWS_REGION: str = os.getenv("AWS_REGION", "")
    AWS_ACCESS_KEY_ID: str = os.getenv("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY: str = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "")
    # 【2026-11 로컬 전환】 비우면 AWS S3, 적으면 그 주소(로컬 S3). 예) http://localhost:9000
    S3_ENDPOINT_URL: str = os.getenv("S3_ENDPOINT_URL", "")

    # Embedding configs
    DEFAULT_EMBEDDING_PROVIDER: str = os.getenv("DEFAULT_EMBEDDING_PROVIDER", "openai")
    DEFAULT_OPENAI_EMBEDDING_MODEL: str = os.getenv("DEFAULT_OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    DEFAULT_GEMINI_EMBEDDING_MODEL: str = os.getenv("DEFAULT_GEMINI_EMBEDDING_MODEL", "models/text-embedding-004")

    # Pydantic Settings 자동화 설정
    class Config:
        case_sensitive = True
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore" 

settings = AISettings()
