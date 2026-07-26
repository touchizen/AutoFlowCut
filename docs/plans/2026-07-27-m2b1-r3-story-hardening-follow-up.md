# M2b-1 R3 Story Hardening Follow-up

M2b-1은 Shopping 신규 coordinator/authority/emit 경계만 다룬다. 아래 항목은 이번 범위 밖이며 후속 Story hardening 대상으로 남긴다.

- synopsis/confirm/research 저장의 abort 게이팅을 포함한 일반 in-flight quiescence는 pre-existing Story machine 특성이다. Story와 Shopping이 다른 폴더를 사용하므로 교차오염은 없지만, 같은 프로젝트를 재open할 때 자기 프로젝트 파일의 in-flight write와 경합할 잔여 위험이 있다.
- `dev`/`ino` 재검증보다 강한 handle-relative `O_NOFOLLOW` 전체 TOCTOU 방어는 현재 실용 범위 밖이다.
