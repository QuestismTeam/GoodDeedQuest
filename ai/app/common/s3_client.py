import logging
from typing import Final

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from .config import settings

logger: Final = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# S3 클라이언트
#
# AI 서버는 S3 객체를 직접 로컬 파일로 다운로드해서(FFmpeg 입력으로 사용) 처리한다.
# backend와 달리 presigned URL은 발급하지 않는다.
# ---------------------------------------------------------------------------


# ===================================================================
# 변경: 키·리전을 무조건 넘기던 것 → 있을 때만 넘기도록
# 이유: backend/app/common/s3_client.py 와 동일 (EC2 IAM Role 지원)
#       리전까지 감싸는 이유는 ai 쪽 AWS_REGION 기본값이 "" 이기 때문.
#       빈 문자열을 넘기면 boto3가 인스턴스 메타데이터에서 리전을 못 읽는다.
# ===================================================================
def _create_s3_client():
    """
    S3 클라이언트를 만든다.

    .env 에 AWS 키가 있으면 그 키를 쓰고(로컬 개발),
    없으면 boto3가 스스로 자격증명을 찾게 둔다(EC2의 IAM Role).
    """
    # 【2026-11 로컬 전환】 S3_ENDPOINT_URL 이 있으면 로컬 S3 로 붙는다.
    # 로컬 S3 는 path 방식만 된다 (이유는 backend/app/common/s3_client.py 참고).
    endpoint_url = settings.S3_ENDPOINT_URL or None

    client_kwargs = {
        "config": Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if endpoint_url else "virtual"},
        ),
    }

    if endpoint_url:
        client_kwargs["endpoint_url"] = endpoint_url

    if settings.AWS_REGION:
        client_kwargs["region_name"] = settings.AWS_REGION

    if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY:
        client_kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
        client_kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY

    return boto3.client("s3", **client_kwargs)


# boto3 S3 클라이언트는 모듈 로드 시 한 번만 생성해서 재사용 (매 요청마다 새로 만들지 않음)
_s3_client = _create_s3_client()


def download_file_from_s3(s3_key: str, local_path: str) -> None:
    """
    S3 객체를 local_path 경로의 로컬 파일로 다운로드한다.
    (FFmpeg 렌더링 입력으로 사용할 이미지/BGM 파일 등)

    Args:
        s3_key: 다운로드할 S3 객체 키
        local_path: 저장할 로컬 파일 경로
    """
    try:
        _s3_client.download_file(settings.S3_BUCKET_NAME, s3_key, local_path)
        logger.info(f"[S3Client] 다운로드 성공: s3_key={s3_key} -> local_path={local_path}")
    except Exception:
        logger.exception(f"[S3Client] 다운로드 실패: s3_key={s3_key}")
        raise


def object_exists_in_s3(s3_key: str) -> bool:
    """
    S3에 해당 key의 객체가 실제로 존재하는지 확인한다.
    (Render Agent가 동영상 대표 프레임 썸네일 key로부터 원본 동영상 key를 역추론할 때 사용)
    """
    try:
        _s3_client.head_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)
        return True
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in ("404", "NoSuchKey"):
            return False
        raise


def upload_file_to_s3(local_path: str, s3_key: str) -> None:
    """
    로컬 파일을 S3에 업로드한다. (Render Agent의 최종 영상 업로드용)

    Args:
        local_path: 업로드할 로컬 파일 경로
        s3_key: 업로드될 S3 객체 키
    """
    try:
        _s3_client.upload_file(local_path, settings.S3_BUCKET_NAME, s3_key)
        logger.info(f"[S3Client] 업로드 성공: local_path={local_path} -> s3_key={s3_key}")
    except Exception:
        logger.exception(f"[S3Client] 업로드 실패: local_path={local_path} -> s3_key={s3_key}")
        raise
