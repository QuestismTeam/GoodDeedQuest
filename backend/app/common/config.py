from functools import lru_cache
from pathlib import Path
from pydantic import PostgresDsn, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[3]
ENV_FILE = ROOT_DIR / ".env"


class Settings(BaseSettings):
    
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )
    
    PROJECT_NAME: str = "Good Deed Quest API"
    API_V1_STR: str = "/api/v1"

    # Security
    SECRET_KEY: SecretStr #env 파일에 있고 5행부터 16번 행이 환경변수 가져오는 코드리 이게 더 안전함 노출 x
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Database
    DATABASE_URL: PostgresDsn #env 파일에 있고 5행부터 16번 행이 환경변수 가져오는 코드리 이게 더 안전함 노출 x

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0" # 보안상 문제없어서 안바꿈 비번 드가면 나중에 환경변수에 넣고 명시한거 지우세요

    # AI Service URL
    AI_SERVICE_URL: str = "http://localhost:8001" # 보안상 문제없어서 안바꿈

    # AI - LLM/Vision
    OPENAI_API_KEY: SecretStr  # .env 파일에 적으세요
    GEMINI_API_KEY: SecretStr  # .env 파일에 적으세요
    DEFAULT_LLM_MODEL: str = "gpt-4o"
    DEFAULT_VISION_MODEL: str = "gemini-1.5-flash"

    # Kakao
    KAKAO_REST_API_KEY: SecretStr | None = None  # .env 파일에 적으세요


    # ===================================================================
    # AWS S3
    # 변경: 필수(SecretStr) → 선택(SecretStr | None)
    # 이유: EC2에서 IAM Role을 쓰면 .env에 키가 없다.
    #       필수로 두면 키가 없을 때 서버가 아예 안 뜬다.
    # ===================================================================
    AWS_REGION: str = "ap-northeast-2"
    AWS_ACCESS_KEY_ID: SecretStr | None = None      # 없으면 IAM Role 사용
    AWS_SECRET_ACCESS_KEY: SecretStr | None = None  # 없으면 IAM Role 사용
    S3_BUCKET_NAME: str = ""

    # 【2026-11 로컬 전환】 AWS 를 내리고 로컬 S3(VersityGW, docker-compose.yml 의 s3 서비스)를 쓰기 위한 값
    # S3_ENDPOINT_URL        : 서버가 붙을 주소. 비우면 AWS S3. 예) http://localhost:9000
    # S3_PUBLIC_ENDPOINT_URL : 앱에 내려줄 URL 의 주소. 비우면 앱이 접속한 주소를 따라간다.
    #                          (backend/app/common/s3_client.py 의 _client_facing_endpoint 참고)
    S3_ENDPOINT_URL: str = ""
    S3_PUBLIC_ENDPOINT_URL: str = ""

    
    DEBUG: bool = False #환경변수에 True로 바꾸면 개발시 편함
    JWT_ALGORITHM: str = "HS256"
    CORS_ORIGINS: list[str] = ["http://localhost:8081"]
    
    GOOGLE_CLIENT_ID: str = "" 

@lru_cache # 같은요청 캐시해놔서 속도 빠름 Depend 안에 넣을 수 있고 import 시 자동실행 막음 기존에는 그냥 자동시행 시도임
def get_setting() -> Settings:
    return Settings()