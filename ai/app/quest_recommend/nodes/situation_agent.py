from datetime import datetime, timedelta, timezone
import logging
from typing import Dict, Any, Final

import httpx

from ai.app.quest_recommend.state import RecommendState


logger: Final = logging.getLogger(__name__)

# 타임아웃을 상수로 분리 3.0초 
WEATHER_API_TIMEOUT_SECONDS: Final[float] = 3.0
# 날씨 조회 실패 및 값 누락 시 사용하는 기본 코드 (0 = 맑음)
DEFAULT_WEATHER_CODE: Final[int] = 0

KST: Final = timezone(timedelta(hours=9))

def get_weather(latitude: float, longitude: float) -> Dict[str, Any]:
    """Open-Meteo API 호출 (위도, 경도로 실시간 날씨 정보 조회)"""
    url = f"https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current_weather=true"
    try:
        response = httpx.get(url, timeout=WEATHER_API_TIMEOUT_SECONDS)
        if response.status_code == 200:
            weather_data = response.json()
            if isinstance(weather_data, dict):
                return weather_data
            logger.warning(f"날씨 API 응답 형식이 dict가 아닙니다 (type: {type(weather_data).__name__}). 빈 결과로 처리합니다.")
            return {}

        logger.warning(f"날씨 API 비정상 응답 (HTTP {response.status_code}). 빈 결과로 처리합니다.")
    except Exception as e:
        logger.warning(f"실시간 동기 날씨 API 통신 중 예외 발생: {e}")
    return {}


def analyze_situation(state: RecommendState) -> Dict[str, Any]:
    """
    현재 시간, 요일, 실시간 날씨 및 위치 정보를 바탕으로
    주변 상황 컨텍스트(situation_context)를 생성하는 LangGraph 노드 함수입니다.
    """
    latitude = state.get("latitude")
    longitude = state.get("longitude")

    now = datetime.now(KST) 
    weekday = now.weekday()

    if weekday in [5, 6]:   # 주말
        is_weekend = True 
        day_of_week_type = "weekend"
    else:                   # 평일
        is_weekend = False  
        day_of_week_type = "weekday"

    today_weather = "sunny"  # 기본값 맑음

    if latitude is None or longitude is None:
        logger.info("사용자 좌표가 없어 실시간 날씨 조회를 생략하고 'sunny'(맑음)로 진행합니다.")
    else:
        weather_data = get_weather(latitude, longitude)
        current_weather = weather_data.get("current_weather") or {}

        weather_code = current_weather.get("weathercode")
        if weather_code is None:
            weather_code = DEFAULT_WEATHER_CODE

        match weather_code:
            case code if code in [0, 1, 2, 3]:
                today_weather = "sunny"     # 맑음
            case code if code in [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]:
                today_weather = "rainy"     # 비
            case code if code in [71, 73, 75, 77, 85, 86]:
                today_weather = "snowy"     # 눈
            case _:
                today_weather = "cloudy"    # 흐림

        logger.info(f"실시간 날씨 조회 완료. weathercode={weather_code} -> '{today_weather}'")
    
    is_outdoor_feasible = False if today_weather in ["rainy", "snowy"] else True

    return {"situation_context": {
        "current_date": str(now.date()),
        "day_of_week_type": day_of_week_type,
        "is_weekend": is_weekend,
        "today_weather": today_weather,
        "is_outdoor_feasible": is_outdoor_feasible
    }}