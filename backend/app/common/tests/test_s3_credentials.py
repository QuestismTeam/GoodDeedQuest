"""
S3 클라이언트 자격증명 해석 테스트.

키가 있으면 boto3에 넘기고, 없으면 넘기지 않는 것을 확인한다.
키를 안 넘겨야 boto3가 EC2 IAM Role을 찾아간다.
"""
import unittest
from unittest.mock import patch, MagicMock

from pydantic import SecretStr


class TestBackendS3Credentials(unittest.TestCase):
    """backend/app/common/s3_client.py 의 _create_s3_client"""

    def _fake_setting(self, access_key, secret_key):
        setting = MagicMock()
        setting.AWS_REGION = "ap-northeast-2"
        setting.AWS_ACCESS_KEY_ID = access_key
        setting.AWS_SECRET_ACCESS_KEY = secret_key
        setting.S3_ENDPOINT_URL = ""
        setting.S3_PUBLIC_ENDPOINT_URL = ""
        return setting

    def test_키가_있으면_boto3에_넘긴다(self):
        """로컬 개발: .env 에 키가 있는 경우"""
        from backend.app.common import s3_client

        setting = self._fake_setting(SecretStr("AKIA_TEST"), SecretStr("SECRET_TEST"))

        with patch.object(s3_client, "get_setting", return_value=setting), \
             patch("backend.app.common.s3_client.boto3.client") as mock_client:
            s3_client._create_s3_client()

        kwargs = mock_client.call_args.kwargs
        self.assertEqual(kwargs["aws_access_key_id"], "AKIA_TEST")
        self.assertEqual(kwargs["aws_secret_access_key"], "SECRET_TEST")
        self.assertEqual(kwargs["region_name"], "ap-northeast-2")

    def test_키가_없으면_boto3에_안_넘긴다(self):
        """EC2: IAM Role 을 쓰는 경우"""
        from backend.app.common import s3_client

        setting = self._fake_setting(None, None)

        with patch.object(s3_client, "get_setting", return_value=setting), \
             patch("backend.app.common.s3_client.boto3.client") as mock_client:
            s3_client._create_s3_client()

        kwargs = mock_client.call_args.kwargs
        self.assertNotIn("aws_access_key_id", kwargs)
        self.assertNotIn("aws_secret_access_key", kwargs)
        # 리전은 기본값이 있으므로 계속 넘어가야 한다
        self.assertEqual(kwargs["region_name"], "ap-northeast-2")

    def test_빈_문자열도_없는_것으로_본다(self):
        """.env 에 AWS_ACCESS_KEY_ID= 만 적고 값을 비운 경우"""
        from backend.app.common import s3_client

        setting = self._fake_setting(SecretStr(""), SecretStr(""))

        with patch.object(s3_client, "get_setting", return_value=setting), \
             patch("backend.app.common.s3_client.boto3.client") as mock_client:
            s3_client._create_s3_client()

        kwargs = mock_client.call_args.kwargs
        self.assertNotIn("aws_access_key_id", kwargs)

    def test_키가_하나만_있으면_안_넘긴다(self):
        """설정 실수 방어: 반쪽짜리 자격증명은 쓰지 않는다"""
        from backend.app.common import s3_client

        setting = self._fake_setting(SecretStr("AKIA_TEST"), None)

        with patch.object(s3_client, "get_setting", return_value=setting), \
             patch("backend.app.common.s3_client.boto3.client") as mock_client:
            s3_client._create_s3_client()

        kwargs = mock_client.call_args.kwargs
        self.assertNotIn("aws_access_key_id", kwargs)


class TestAiS3Credentials(unittest.TestCase):
    """ai/app/common/s3_client.py 의 _create_s3_client"""

    def test_키가_있으면_boto3에_넘긴다(self):
        from ai.app.common import s3_client

        fake_settings = MagicMock()
        fake_settings.AWS_REGION = "ap-northeast-2"
        fake_settings.AWS_ACCESS_KEY_ID = "AKIA_TEST"
        fake_settings.AWS_SECRET_ACCESS_KEY = "SECRET_TEST"
        fake_settings.S3_ENDPOINT_URL = ""

        with patch.object(s3_client, "settings", fake_settings), \
             patch("ai.app.common.s3_client.boto3.client") as mock_client:
            s3_client._create_s3_client()

        kwargs = mock_client.call_args.kwargs
        self.assertEqual(kwargs["aws_access_key_id"], "AKIA_TEST")
        self.assertEqual(kwargs["region_name"], "ap-northeast-2")

    def test_키와_리전이_비면_아무것도_안_넘긴다(self):
        """EC2: IAM Role + 인스턴스 메타데이터에서 리전을 읽는 경우"""
        from ai.app.common import s3_client

        fake_settings = MagicMock()
        fake_settings.AWS_REGION = ""
        fake_settings.AWS_ACCESS_KEY_ID = ""
        fake_settings.AWS_SECRET_ACCESS_KEY = ""
        fake_settings.S3_ENDPOINT_URL = ""

        with patch.object(s3_client, "settings", fake_settings), \
             patch("ai.app.common.s3_client.boto3.client") as mock_client:
            s3_client._create_s3_client()

        kwargs = mock_client.call_args.kwargs
        self.assertNotIn("aws_access_key_id", kwargs)
        self.assertNotIn("region_name", kwargs)


class TestLocalMinioEndpoint(unittest.TestCase):
    """2026-11 로컬 전환: S3_ENDPOINT_URL 이 있으면 로컬 S3 로 붙는다"""

    def _fake_setting(self, endpoint="", public=""):
        setting = MagicMock()
        setting.AWS_REGION = "ap-northeast-2"
        setting.AWS_ACCESS_KEY_ID = SecretStr("gooddeed")
        setting.AWS_SECRET_ACCESS_KEY = SecretStr("gooddeed123")
        setting.S3_ENDPOINT_URL = endpoint
        setting.S3_PUBLIC_ENDPOINT_URL = public
        return setting

    def test_엔드포인트가_있으면_path_방식으로_붙는다(self):
        from backend.app.common import s3_client

        setting = self._fake_setting(endpoint="http://localhost:9000")
        with patch.object(s3_client, "get_setting", return_value=setting), \
             patch("backend.app.common.s3_client.boto3.client") as mock_client:
            s3_client._create_s3_client()

        kwargs = mock_client.call_args.kwargs
        self.assertEqual(kwargs["endpoint_url"], "http://localhost:9000")
        self.assertEqual(kwargs["config"].s3["addressing_style"], "path")

    def test_엔드포인트가_없으면_예전처럼_AWS(self):
        from backend.app.common import s3_client

        setting = self._fake_setting()
        with patch.object(s3_client, "get_setting", return_value=setting), \
             patch("backend.app.common.s3_client.boto3.client") as mock_client:
            s3_client._create_s3_client()

        kwargs = mock_client.call_args.kwargs
        self.assertNotIn("endpoint_url", kwargs)
        self.assertEqual(kwargs["config"].s3["addressing_style"], "virtual")

    def _facing(self, setting, host):
        from backend.app.common import s3_client

        with patch.object(s3_client, "get_setting", return_value=setting):
            token = s3_client.remember_request_host(host)
            try:
                return s3_client._client_facing_endpoint()
            finally:
                s3_client.forget_request_host(token)

    def test_앱에_주는_주소는_앱이_접속한_호스트를_따라간다(self):
        setting = self._fake_setting(endpoint="http://s3:9000")
        self.assertEqual(self._facing(setting, "192.168.0.10"), "http://192.168.0.10:9000")

    def test_요청_밖에서는_내부_주소를_쓴다(self):
        """Celery 처럼 요청이 없으면 None → 기본(내부) 클라이언트"""
        setting = self._fake_setting(endpoint="http://s3:9000")
        self.assertIsNone(self._facing(setting, None))

    def test_공개_주소를_적으면_그게_이긴다(self):
        setting = self._fake_setting(endpoint="http://s3:9000", public="http://my-mac.local:9000")
        self.assertEqual(self._facing(setting, "192.168.0.10"), "http://my-mac.local:9000")

    def test_AWS_면_호스트와_상관없이_그대로(self):
        setting = self._fake_setting()
        self.assertIsNone(self._facing(setting, "192.168.0.10"))

    def test_ai_도_엔드포인트를_따른다(self):
        from ai.app.common import s3_client

        fake_settings = MagicMock()
        fake_settings.AWS_REGION = "ap-northeast-2"
        fake_settings.AWS_ACCESS_KEY_ID = "gooddeed"
        fake_settings.AWS_SECRET_ACCESS_KEY = "gooddeed123"
        fake_settings.S3_ENDPOINT_URL = "http://localhost:9000"

        with patch.object(s3_client, "settings", fake_settings), \
             patch("ai.app.common.s3_client.boto3.client") as mock_client:
            s3_client._create_s3_client()

        kwargs = mock_client.call_args.kwargs
        self.assertEqual(kwargs["endpoint_url"], "http://localhost:9000")
        self.assertEqual(kwargs["config"].s3["addressing_style"], "path")


if __name__ == "__main__":
    unittest.main()