from datetime import datetime
from decimal import Decimal
from sqlalchemy import BigInteger, Integer, String, Text, ForeignKey, DECIMAL, TIMESTAMP, Enum, func, JSON
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.common.database import Base
from backend.app.map.enums import CompetitionStatus


class VolunteerCenter(Base):
    __tablename__ = "volunteer_center"

    center_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True, comment="봉사센터 ID")
    region_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("region.region_id"), nullable=False, comment="지역 FK")
    vol_name: Mapped[str] = mapped_column(String(200), nullable=True, comment="봉사센터명")
    vol_address: Mapped[str] = mapped_column(String(255), nullable=True, comment="봉사센터 주소")
    target: Mapped[str] = mapped_column(String(200), nullable=True, comment="봉사 대상")
    vms_url: Mapped[str] = mapped_column(String(500), nullable=True, comment="VMS 원본 URL")
    vol_qual: Mapped[str] = mapped_column(String(500), nullable=True, comment="봉사 자격요건")
    vol_act: Mapped[str] = mapped_column(String(2000), nullable=True, comment="봉사 활동내용")
    vol_date: Mapped[str] = mapped_column(String(1000), nullable=True, comment="봉사 가능일자")
    latitude: Mapped[Decimal] = mapped_column(DECIMAL(10, 7), nullable=True, comment="봉사센터 위도")
    longitude: Mapped[Decimal] = mapped_column(DECIMAL(10, 7), nullable=True, comment="봉사센터 경도")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), comment="마지막 크롤링 확인 시각")
    vol_title: Mapped[str] = mapped_column(String(500), nullable=True, comment="봉사 모집 제목")
    ai_category: Mapped[str] = mapped_column(
        String(50), nullable=True,
        comment="AI 임베딩 기반 의미 카테고리 (환경/동물/아동청소년/어르신/장애인/교육/다문화/재난안전/기타)"
    )
    embedding: Mapped[dict] = mapped_column(JSON, nullable=True, comment="봉사 공고 텍스트 임베딩 벡터")


    quest_title: Mapped[str] = mapped_column(
        String(200), nullable=True,
        comment="AI가 생성한 퀘스트용 정리 제목 (장식문자·모집·차수 제거, Quest.quest_title과 동일 길이)"
    )
    quest_summary: Mapped[str] = mapped_column(
        Text, nullable=True,
        comment="AI가 생성한 한 문장 활동 요약 (퀘스트 상세 화면 설명문)"
    )

class Region(Base):
    __tablename__ = "region"

    region_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True, comment="지역 고유 번호")
    city_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("city.city_id"), nullable=False, comment="시도FK")
    region_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="지역명(시군구)")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), comment="생성일시")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), comment="수정일시")


class City(Base):
    __tablename__ = "city"

    city_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True, comment="행정구역 고유번호")
    city_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="행정구역명")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), comment="생성일시")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), comment="수정일시")


class Competition(Base):
    __tablename__ = "competition"

    competition_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="대회 고유번호")
    title: Mapped[str] = mapped_column(String(200), nullable=True, comment="대회명")
    description: Mapped[str] = mapped_column(Text, nullable=True, comment="대회 설명")
    status: Mapped[CompetitionStatus] = mapped_column(Enum(CompetitionStatus), nullable=True, comment="대회 상태 (IN_PROGRESS/SETTLING)")
    start_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=True, comment="시작일시")
    end_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=True, comment="종료일시")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), comment="생성일시")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), comment="수정일시")


class CompetitionParticipant(Base):
    __tablename__ = "competition_participant"

    participant_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="참가 고유번호")
    competition_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("competition.competition_id"), nullable=False, comment="대회 FK")
    region_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("region.region_id"), nullable=False, index=True, comment="참가 지역 FK")
    score: Mapped[int] = mapped_column(Integer, nullable=True, comment="지역 누적 점수")
    rank: Mapped[int] = mapped_column(Integer, nullable=True, comment="지역 순위")
    joined_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), comment="참가일시")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), comment="수정일시")


class CompetitionContribution(Base):
    __tablename__ = "competition_contribution"

    contribution_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="기여 고유번호")
    competition_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("competition.competition_id"), nullable=False, comment="대회 FK")
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("user.user_id"), nullable=False, comment="기여자 user FK")
    submission_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("quest_submission.submission_id"), nullable=False, comment="퀘스트 인증 제출 FK")
    region_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("region.region_id"), nullable=False, index=True, comment="기여 지역 FK")
    points: Mapped[int] = mapped_column(Integer, nullable=True, comment="획득 포인트")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, server_default=func.now(), comment="생성일시")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=True, onupdate=func.now(), comment="수정일시")