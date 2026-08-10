from __future__ import annotations

from typing import Any

import httpx

from backend.app.common.config import get_setting


VOL_CATEGORY_COMMENT_PATH = "/ai/vol-category/lacking-comment"

VOL_CATEGORY_COMMENT_TIMEOUT = httpx.Timeout(
    connect=3.0,
    read=15.0,
    write=5.0,
    pool=5.0,
)


class VolCategoryCommentClientError(Exception):
    pass


class VolCategoryCommentAIClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout: httpx.Timeout = VOL_CATEGORY_COMMENT_TIMEOUT,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        configured_base_url = (
            base_url if base_url is not None else get_setting().AI_SERVICE_URL
        )
        self.base_url = configured_base_url.rstrip("/")
        self.timeout = timeout
        self.transport = transport

    @property
    def comment_url(self) -> str:
        return f"{self.base_url}{VOL_CATEGORY_COMMENT_PATH}"

    def request_comment(self, *, payload: dict[str, Any]) -> str:
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
                response = client.post(
                    self.comment_url,
                    json=payload,
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                )
        except httpx.TimeoutException as exc:
            raise VolCategoryCommentClientError(
                "AI 문구 생성 서버의 응답 시간이 초과되었습니다."
            ) from exc
        except httpx.RequestError as exc:
            raise VolCategoryCommentClientError(
                "AI 문구 생성 서버에 연결할 수 없습니다."
            ) from exc

        if not (200 <= response.status_code < 300):
            raise VolCategoryCommentClientError(
                f"AI 문구 생성 서버가 오류를 반환했습니다 (status={response.status_code})."
            )

        try:
            data = response.json()
        except ValueError as exc:
            raise VolCategoryCommentClientError(
                "AI 문구 생성 서버 응답이 올바른 JSON이 아닙니다."
            ) from exc

        comment = data.get("comment") if isinstance(data, dict) else None
        if not isinstance(comment, str) or not comment.strip():
            raise VolCategoryCommentClientError(
                "AI 문구 생성 서버 응답에 comment 필드가 없습니다."
            )

        return comment