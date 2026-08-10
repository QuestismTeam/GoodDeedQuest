import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta

import requests
from bs4 import BeautifulSoup

LIST_URL = "https://www.vms.or.kr/partspace/recruit.do"
DETAIL_URL = "https://www.vms.or.kr/partspace/recruitView.do"
KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
}



def fetch_list_page(page: int, sttdte: str, enddte: str, page_size: int = 12, status: int = 1) -> str:
    params = {
        "sttdte": sttdte,
        "enddte": enddte,
        "rcritsttdte": "",
        "rcritenddte": "",
        "pageSize": page_size,
        "page": page,
        "status": status,
        "area": "",
        "areagugun": "",
        "areadiv": "",
        "termgbn": "",
        "searchType": "title",
        "searchValue": "",
        "acttype": "",
        "volacttype": "",
    }
    resp = requests.get(LIST_URL, params=params, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return resp.text


def parse_list_page(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    cards = soup.select("li.card")
    results = []

    for card in cards:
        a_tag = card.find("a")
        if a_tag is None or not a_tag.get("href"):
            continue

        href = a_tag["href"]
        seq_match = re.search(r"seq=(\d+)", href)
        if seq_match is None:
            continue
        seq = int(seq_match.group(1))

        chips = card.select("div.chips span.chip")
        region_sido = chips[0].get_text(strip=True) if len(chips) >= 1 else None
        activity_type = chips[1].get_text(strip=True) if len(chips) >= 2 else None

        title_tag = card.select_one("h3.title")
        title = None
        if title_tag is not None:
            badge = title_tag.find("span", class_="badge-b")
            if badge is not None:
                badge.extract()
            title = title_tag.get_text(strip=True)

        org_tag = card.select_one("div.org")
        org = org_tag.get_text(strip=True) if org_tag else None

        period = None
        m_left = card.select_one("div.m-left")
        if m_left is not None:
            h5 = m_left.find("h5")
            if h5 is not None:
                h5.extract()
            period = m_left.get_text(strip=True)

        count_tag = card.select_one("span.count")
        applied_count = capacity = None
        if count_tag is not None:
            count_text = count_tag.get_text(strip=True)
            m = re.search(r"(\d+)\s*/\s*(\d+)", count_text)
            if m:
                applied_count, capacity = int(m.group(1)), int(m.group(2))

        state_tag = card.select_one("span.state")
        status_text = state_tag.get_text(strip=True) if state_tag else None

        results.append({
            "seq": seq,
            "region_sido": region_sido,
            "activity_type": activity_type,
            "title": title,
            "org": org,
            "period": period,
            "applied_count": applied_count,
            "capacity": capacity,
            "status_text": status_text,
            "detail_url": f"{DETAIL_URL}?seq={seq}",
        })

    return results


def crawl_list_all(days_window: int = 30, page_size: int = 12, sleep_sec: float = 0.5,
                    max_pages: int = 500) -> list[dict]:
    sttdte = date.today().isoformat()
    enddte = (date.today() + timedelta(days=days_window)).isoformat()

    all_results = []
    seen_seqs: set[int] = set()
    page = 1
    while page <= max_pages:
        html = fetch_list_page(page=page, sttdte=sttdte, enddte=enddte, page_size=page_size)
        items = parse_list_page(html)
        if not items:
            print(f"[list page {page}] 카드 0개 -> 종료")
            break

        page_seqs = [item["seq"] for item in items]
        already_seen = [s for s in page_seqs if s in seen_seqs]
        print(f"[list page {page}] {len(items)}건, seq 범위 {page_seqs[0]}~{page_seqs[-1]}, 중복 {len(already_seen)}개")

        if len(already_seen) == len(items):
            print("!! 이전 페이지와 완전히 동일한 결과 -> page 파라미터가 안 먹히는 것으로 판단, 중단")
            break

        for item in items:
            if item["seq"] not in seen_seqs:
                seen_seqs.add(item["seq"])
                all_results.append(item)

        page += 1
        time.sleep(sleep_sec)

    if page > max_pages:
        print(f"!! 안전장치: max_pages({max_pages}) 도달해서 강제 종료")

    return all_results



def fetch_detail_page(seq: int) -> str:
    resp = requests.get(DETAIL_URL, params={"seq": seq}, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return resp.text


def parse_detail_page(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")

    def _clean(text: str | None) -> str | None:
        if text is None:
            return None
        cleaned = re.sub(r"\s+", " ", text).strip()
        return cleaned or None

    title_tag = soup.select_one(".page-head .title")
    title = _clean(title_tag.get_text()) if title_tag else None

    status_tag = soup.select_one(".page-head .badge")
    status_text = _clean(status_tag.get_text()) if status_tag else None

    kv: dict[str, str] = {}
    for tr in soup.select("table.eval-kv tr.pair"):
        cells = tr.find_all(["th", "td"])
        for i in range(0, len(cells) - 1, 2):
            key = _clean(cells[i].get_text())
            val = _clean(cells[i + 1].get_text())
            if key:
                kv[key] = val

    qual: dict[str, str] = {}
    for tr in soup.select("table.tbl-basic tr"):
        th = tr.find("th")
        td = tr.find("td")
        if th is not None and td is not None:
            key = _clean(th.get_text())
            if key:
                qual[key] = _clean(td.get_text())

    content_tag = soup.select_one(".board-content")
    content = None
    if content_tag is not None:
        note = content_tag.select_one(".note-warn")
        if note is not None:
            note.extract()
        content = content_tag.get_text(separator="\n", strip=True)

    return {
        "title": title,
        "status_text": status_text,
        "vol_period": kv.get("활동기간"),
        "recruit_period": kv.get("모집기간"),
        "vol_field": kv.get("활동분야"),
        "vol_org": kv.get("봉사활동처"),
        "vol_cycle": kv.get("활동주기"),
        "vol_region": kv.get("봉사지역"),
        "vol_place": kv.get("봉사장소"),
        "vol_target": kv.get("봉사대상"),
        "capacity_text": kv.get("필요/신청 인원"),
        "activity_type": kv.get("활동유형"),
        "age_req": qual.get("봉사자연령"),
        "gender_req": qual.get("봉사자성별"),
        "qual_req": qual.get("자격요건"),
        "edu_req": qual.get("사전교육"),
        "content": content,
    }


def parse_region_text(vol_region_text: str) -> tuple[str | None, str | None]:
    if not vol_region_text:
        return None, None
    m = re.match(r"\[(.+?)\]\s*(.+)", vol_region_text.strip())
    if not m:
        return None, None
    rest = m.group(2).strip()
    parts = rest.split(maxsplit=1)
    sido_full = parts[0] if len(parts) >= 1 else None
    gugun = parts[1] if len(parts) >= 2 else None
    return sido_full, gugun



def _kakao_api_key() -> str | None:
    from backend.app.common.config import get_setting

    key = get_setting().KAKAO_REST_API_KEY
    if key is None:
        return None
    return key.get_secret_value() if hasattr(key, "get_secret_value") else key


_kakao_cache: dict[str, dict | None] = {}
_kakao_cache_lock = threading.Lock()


def kakao_keyword_search(query: str) -> dict | None:
    with _kakao_cache_lock:
        if query in _kakao_cache:
            return _kakao_cache[query]

    api_key = _kakao_api_key()
    if not api_key or not query:
        return None
    headers = {"Authorization": f"KakaoAK {api_key}"}
    try:
        resp = requests.get(
            KAKAO_KEYWORD_URL, params={"query": query, "size": 1}, headers=headers, timeout=5
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  (카카오 검색 실패: {query!r} - {e})")
        with _kakao_cache_lock:
            _kakao_cache[query] = None
        return None
    docs = (resp.json() or {}).get("documents") or []
    result = docs[0] if docs else None
    with _kakao_cache_lock:
        _kakao_cache[query] = result
    return result


SIDO_ABBR_TO_FULL = {
    "경남": "경상남도",
    "경북": "경상북도",
    "충남": "충청남도",
    "충북": "충청북도",
    "전남": "전라남도",
}


def parse_sido_gugun_from_address(address_name: str | None) -> tuple[str | None, str | None]:
    if not address_name:
        return None, None
    tokens = address_name.split()
    if not tokens:
        return None, None

    sido = SIDO_ABBR_TO_FULL.get(tokens[0], tokens[0])
    if "세종" in sido:
        return sido, "세종시"

    if len(tokens) >= 3 and tokens[1].endswith("시") and tokens[2].endswith("구"):
        gugun = f"{tokens[1]} {tokens[2]}"
    elif len(tokens) >= 2:
        gugun = tokens[1]
    else:
        gugun = None
    return sido, gugun


PLACE_NAME_SUFFIX_PATTERN = re.compile(
    r"\s*(내부|내|지하\d*층?|지하|옆|앞|인근|부근|근처|일대|\d+층)$"
)


def clean_place_name(name: str | None) -> str | None:
    if not name:
        return None
    cleaned = name.strip()
    while True:
        new_cleaned = PLACE_NAME_SUFFIX_PATTERN.sub("", cleaned).strip()
        if new_cleaned == cleaned or not new_cleaned:
            break
        cleaned = new_cleaned
    return cleaned or None


def _kakao_candidates(place_name: str | None) -> list[str]:
    cleaned = clean_place_name(place_name)
    if not cleaned:
        return []
    candidates = [cleaned]
    no_space = cleaned.replace(" ", "")
    if no_space != cleaned:
        candidates.append(no_space)
    first_word = cleaned.split()[0] if " " in cleaned else None
    if first_word and len(first_word) >= 2:
        candidates.append(first_word)
    return candidates


def resolve_via_kakao(db, place_name: str | None) -> dict | None:
    candidates = _kakao_candidates(place_name)
    if not candidates:
        return None

    doc = None
    for query in candidates:
        doc = kakao_keyword_search(query)
        if doc is not None:
            break
    if doc is None:
        return None

    return resolve_via_kakao_doc(db, doc, place_name or "")


def kakao_lookup_raw(place_name: str | None) -> dict | None:
    candidates = _kakao_candidates(place_name)
    for query in candidates:
        doc = kakao_keyword_search(query)
        if doc is not None:
            return doc
    return None


def resolve_via_kakao_doc(db, doc: dict | None, place_name: str) -> dict | None:
    if doc is None:
        return None

    address_name = doc.get("road_address_name") or doc.get("address_name")
    sido, gugun = parse_sido_gugun_from_address(address_name)
    region_id = resolve_region_id(db, sido, gugun, extra_text=place_name or "")
    if region_id is None:
        return None

    try:
        lat = float(doc["y"]) if doc.get("y") else None
        lng = float(doc["x"]) if doc.get("x") else None
    except (TypeError, ValueError):
        lat = lng = None

    return {"region_id": region_id, "address_name": address_name, "lat": lat, "lng": lng}



def parse_end_date(vol_date_text: str) -> date | None:
    if not vol_date_text or "~" not in vol_date_text:
        return None
    end_str = vol_date_text.split("~")[-1].strip()
    try:
        return datetime.strptime(end_str, "%Y-%m-%d").date()
    except ValueError:
        return None



MERGED_JEONNAM_GWANGJU_CITY_IDS = [24, 36]
MERGED_JEONNAM_GWANGJU_ALIASES = ("전남광주", "광주전남")


def resolve_region_id(db, sido_full: str | None, gugun: str | None, extra_text: str = "") -> int | None:
    from sqlalchemy import or_

    from backend.app.map.models import City, Region

    if not sido_full or not gugun:
        return None

    region_name_filter = or_(Region.region_name == gugun, Region.region_name.like(f"{gugun} %"))

    if any(alias in sido_full for alias in MERGED_JEONNAM_GWANGJU_ALIASES):
        candidates = (
            db.query(Region)
            .filter(Region.city_id.in_(MERGED_JEONNAM_GWANGJU_CITY_IDS), region_name_filter)
            .all()
        )
    else:
        city = db.query(City).filter(City.city_name.like(f"%{sido_full}%")).first()
        if city is None:
            return None
        candidates = (
            db.query(Region)
            .filter(Region.city_id == city.city_id, region_name_filter)
            .all()
        )

    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0].region_id

    matched = []
    for c in candidates:
        suffix = c.region_name.replace(gugun, "", 1).strip()
        core = re.sub(r"(구|군|시)$", "", suffix)
        if core and core in extra_text:
            matched.append(c)
    if len(matched) == 1:
        return matched[0].region_id
    return None


def _trunc(text: str | None, max_len: int) -> str | None:
    if text is None:
        return None
    return text if len(text) <= max_len else text[:max_len]


def build_center_fields(
    db, list_item: dict, detail: dict,
    kakao_result: dict | None = None, kakao_precomputed: bool = False,
) -> dict | None:
    if not kakao_precomputed:
        kakao_result = (
            resolve_via_kakao(db, detail.get("vol_place"))
            or resolve_via_kakao(db, detail.get("vol_org"))
        )

    if kakao_result is not None:
        region_id = kakao_result["region_id"]
        vol_address = kakao_result["address_name"]
        latitude = kakao_result["lat"]
        longitude = kakao_result["lng"]
    else:
        sido_full, gugun = parse_region_text(detail.get("vol_region"))
        extra_text = " ".join(x for x in [detail.get("vol_place"), detail.get("title"), detail.get("vol_org")] if x)
        region_id = resolve_region_id(db, sido_full, gugun, extra_text=extra_text)
        if region_id is None:
            return None
        vol_address = " ".join(x for x in [detail.get("vol_region"), detail.get("vol_place")] if x)
        latitude = longitude = None

    qual_parts = [
        f"연령: {detail.get('age_req')}" if detail.get("age_req") else None,
        f"성별: {detail.get('gender_req')}" if detail.get("gender_req") else None,
        f"자격요건: {detail.get('qual_req')}" if detail.get("qual_req") else None,
        f"사전교육: {detail.get('edu_req')}" if detail.get("edu_req") else None,
    ]
    vol_qual = " / ".join(p for p in qual_parts if p)

    return {
        "region_id": region_id,
        "vol_name": _trunc(detail.get("vol_org") or list_item.get("org"), 200),
        "vol_title": _trunc(detail.get("title") or list_item.get("title"), 500),
        "vol_address": _trunc(vol_address, 255),
        "target": _trunc(detail.get("vol_target"), 200),
        "vms_url": _trunc(list_item.get("detail_url"), 500),
        "vol_qual": _trunc(vol_qual or None, 500),
        "vol_act": _trunc(detail.get("content"), 2000),
        "vol_date": _trunc(detail.get("vol_period"), 1000),
        "latitude": latitude,
        "longitude": longitude,
    }


def upsert_volunteer_center(db, seq: int, fields: dict):
    from backend.app.map.models import VolunteerCenter

    center = db.get(VolunteerCenter, seq)
    if center is None:
        center = VolunteerCenter(center_id=seq, **fields)
        db.add(center)
    else:
        for k, v in fields.items():
            setattr(center, k, v)
    db.commit()


def delete_expired_centers(db):
    from backend.app.map.models import VolunteerCenter

    centers = db.query(VolunteerCenter).all()
    today = date.today()
    expired_ids = [
        c.center_id for c in centers
        if (end := parse_end_date(c.vol_date)) is not None and end < today
    ]
    if expired_ids:
        db.query(VolunteerCenter).filter(VolunteerCenter.center_id.in_(expired_ids)).delete(
            synchronize_session=False
        )
        db.commit()
    print(f"마감 공고 {len(expired_ids)}건 삭제")



def fetch_item_bundle(item: dict, detail_sleep_sec: float = 0.1) -> dict:
    seq = item["seq"]
    try:
        html = fetch_detail_page(seq)
    except requests.RequestException as e:
        return {"item": item, "detail": None, "kakao_doc": None, "error": str(e)}

    detail = parse_detail_page(html)
    kakao_doc = kakao_lookup_raw(detail.get("vol_place")) or kakao_lookup_raw(detail.get("vol_org"))

    if detail_sleep_sec:
        time.sleep(detail_sleep_sec)

    return {"item": item, "detail": detail, "kakao_doc": kakao_doc, "error": None}


def run_crawl(db, days_window: int = 30, sleep_sec: float = 0.5, max_pages: int = 500,
              refetch_existing: bool = False, max_workers: int = 16, detail_sleep_sec: float = 0.1):
    print("=== 1) 마감 공고 정리 ===")
    delete_expired_centers(db)

    print("\n=== 2) 목록 수집 ===")
    list_items = crawl_list_all(days_window=days_window, sleep_sec=sleep_sec, max_pages=max_pages)
    print(f"목록 총 {len(list_items)}건")

    if not refetch_existing:
        from backend.app.map.models import VolunteerCenter
        existing_ids = {row[0] for row in db.query(VolunteerCenter.center_id).all()}
        before = len(list_items)
        list_items = [item for item in list_items if item["seq"] not in existing_ids]
        print(f"이미 저장된 {before - len(list_items)}건은 상세크롤링 건너뜀 (남은 {len(list_items)}건만 진행)")

    total = len(list_items)
    print(f"\n=== 3) 상세 수집(병렬 {max_workers}개) + DB 저장(순차) ===")
    saved, skipped = 0, 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(fetch_item_bundle, item, detail_sleep_sec): item
            for item in list_items
        }
        for done_count, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            item = result["item"]
            seq = item["seq"]

            if result["error"] is not None:
                skipped += 1
                print(f"[{done_count}/{total}] seq={seq} 요청 실패 -> 스킵 ({result['error']})")
                continue

            detail = result["detail"]
            place_name = detail.get("vol_place") or detail.get("vol_org") or ""
            kakao_result = resolve_via_kakao_doc(db, result["kakao_doc"], place_name)

            fields = build_center_fields(db, item, detail, kakao_result=kakao_result, kakao_precomputed=True)
            if fields is None:
                skipped += 1
                print(f"[{done_count}/{total}] seq={seq} region 매칭 실패 -> 스킵 (봉사지역: {detail.get('vol_region')})")
            else:
                upsert_volunteer_center(db, seq, fields)
                saved += 1

    print(f"\n완료: 저장 {saved}건, 스킵 {skipped}건")


def backfill_missing_fields(db, sleep_sec: float = 0.5):
    from backend.app.map.models import VolunteerCenter

    targets = (
        db.query(VolunteerCenter)
        .filter((VolunteerCenter.vol_title.is_(None)) | (VolunteerCenter.latitude.is_(None)))
        .all()
    )
    print(f"제목/위경도 없는 기존 공고 {len(targets)}건 백필 시작")

    updated, skipped = 0, 0
    for i, center in enumerate(targets, start=1):
        seq = center.center_id
        try:
            html = fetch_detail_page(seq)
        except requests.RequestException as e:
            skipped += 1
            print(f"[{i}/{len(targets)}] seq={seq} 요청 실패 -> 스킵 ({e})")
            time.sleep(sleep_sec)
            continue

        detail = parse_detail_page(html)
        center.vol_title = detail.get("title")

        kakao_result = (
            resolve_via_kakao(db, detail.get("vol_place"))
            or resolve_via_kakao(db, detail.get("vol_org"))
        )
        if kakao_result is None:
            skipped += 1
            print(f"[{i}/{len(targets)}] seq={seq} 카카오 검색 실패 -> 좌표는 못 채움(제목만 채움)")
        else:
            center.region_id = kakao_result["region_id"]
            center.vol_address = kakao_result["address_name"]
            center.latitude = kakao_result["lat"]
            center.longitude = kakao_result["lng"]
            updated += 1
        db.commit()
        time.sleep(sleep_sec)

    print(f"\n백필 완료: 좌표까지 채움 {updated}건, 제목만 채움/좌표 실패 {skipped}건")


if __name__ == "__main__":
    from backend.app.common.database import SessionLocal

    db = SessionLocal()
    try:
        run_crawl(db)
    finally:
        db.close()