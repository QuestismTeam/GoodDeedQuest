import csv
import os

CSV_DIR = os.path.dirname(os.path.abspath(__file__))


def load_csv(filename: str) -> list[dict]:
    path = os.path.join(CSV_DIR, filename)
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def seed_cities(db) -> None:
    from backend.app.map.models import City

    rows = load_csv("city_seed.csv")
    created = 0
    for row in rows:
        city_id = int(row["city_id"])
        if db.get(City, city_id) is None:
            db.add(City(city_id=city_id, city_name=row["city_name"]))
            created += 1
    db.commit()
    print(f"City: {created}개 생성 (파일 기준 총 {len(rows)}개)")


def seed_regions(db) -> None:
    from backend.app.map.models import Region

    rows = load_csv("region_seed.csv")
    created = 0
    for row in rows:
        region_id = int(row["region_id"])
        if db.get(Region, region_id) is None:
            db.add(Region(
                region_id=region_id,
                city_id=int(row["city_id"]),
                region_name=row["region_name"],
            ))
            created += 1
    db.commit()
    print(f"Region: {created}개 생성 (파일 기준 총 {len(rows)}개)")


if __name__ == "__main__":
    from backend.app.common.database import SessionLocal

    db = SessionLocal()
    try:
        seed_cities(db)
        seed_regions(db)
    finally:
        db.close()