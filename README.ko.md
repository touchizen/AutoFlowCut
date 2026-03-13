<img src="assets/icon.png?v=20260313" width="80" align="left" alt="AutoFlowCut icon" />

# AutoFlowCut

대량 이미지 자동 생성 도구 — Google Flow AI로 수백 장의 이미지/비디오를 한 번에 생성하고 CapCut 프로젝트로 원클릭 내보내기

[🇺🇸 English](README.md) | 🇰🇷 한국어

## AutoFlowCut이란?

AutoFlowCut은 숏폼 영상 제작을 자동화하는 데스크톱 앱입니다:

1. **씬 작성** — 자막과 AI 프롬프트로 영상 씬 정의
2. **미디어 생성** — AI가 이미지(T2I) 생성, 선택적으로 비디오(T2V, I2V)도 생성
3. **CapCut 내보내기** — 원클릭으로 CapCut 프로젝트 생성 (미디어 + 자막 타임라인 배치)

수백 장의 이미지를 편집기에 수동으로 끌어다 놓을 필요가 없습니다.

## 주요 기능

- **Google Flow AI 연동** — Text-to-Image, Text-to-Video (T2V), Image-to-Video (I2V)
- **대량 자동 생성** — 수백 장의 이미지/비디오를 클릭 한 번으로 자동 생성
- **씬 관리** — 자막, 프롬프트로 씬 추가/편집/정렬
- **CapCut 내보내기** — 이미지, 비디오, 자막이 포함된 CapCut 프로젝트 자동 생성
- **프로젝트 저장/복원** — 작업 저장 후 나중에 이어서 작업
- **매칭 태그** — 씬 간 일관된 캐릭터/스타일 유지

## 다운로드

| 플랫폼 | 다운로드 |
|--------|----------|
| macOS (Apple Silicon) | [AutoFlowCut-0.9.0-arm64.dmg](https://github.com/touchizen/AutoFlowCut/releases/latest) |
| Windows | [Microsoft Store](https://apps.microsoft.com/detail/9p2d9g1f4j7q) |

## 시작하기

### 1. 설치 및 실행

**macOS:**
- [Releases](https://github.com/touchizen/AutoFlowCut/releases)에서 `.dmg` 파일 다운로드
- `AutoFlowCut`을 Applications 폴더로 드래그
- 첫 실행 시 우클릭 → 열기 (Gatekeeper 우회)

**Windows:**
- Microsoft Store에서 설치

### 2. Google 로그인

- AutoFlowCut이 내장 브라우저에서 Google Flow AI (labs.google/fx) 를 엽니다
- Google 계정으로 로그인
- 앱이 자동으로 로그인을 감지합니다

### 3. 씬 만들기

- **씬** 탭으로 이동
- 자막과 이미지 프롬프트로 씬 추가
- 필요시 **매칭 태그**를 추가하여 일관된 스타일 유지

### 4. 이미지 생성

- **전체 생성** 클릭하여 모든 씬의 이미지 생성
- Google Flow AI를 통해 이미지 생성
- 실시간 진행 상황 표시

### 5. 비디오 생성 (선택)

- **T2V** (텍스트→비디오) 또는 **I2V** (이미지→비디오) 탭으로 전환
- 프롬프트나 기존 이미지로 비디오 생성
- 씬별로 사용할 미디어(이미지/T2V/I2V) 선택

### 6. CapCut으로 내보내기

- **CapCut 내보내기** 클릭
- 내보내기 설정 선택 (재생 시간, 해상도)
- 미디어와 자막이 타임라인에 배치된 CapCut 프로젝트 생성
- CapCut 열기 → 가져오기 → 바로 편집 가능

## 작업 흐름

```
씬 (자막 + 프롬프트)
    ↓
이미지 생성 (Google Flow AI)
    ↓ (선택)
비디오 생성 (T2V / I2V)
    ↓
씬별 미디어 선택 (이미지 / T2V / I2V)
    ↓
CapCut 프로젝트 내보내기
    ↓
CapCut에서 편집 및 게시
```

## 요구 사항

- **macOS** 11.0+ (Apple Silicon) 또는 **Windows** 10+
- **Google 계정** (Flow AI 접근용)
- **CapCut** 데스크톱 앱 (내보낸 프로젝트 편집용)
- 인터넷 연결

## 기술 스택

- Electron + React 18 + Vite 6
- Google Flow AI (labs.google/fx)
- CapCut draft 포맷 내보내기

## 라이선스

MIT License — [LICENSE](LICENSE) 참조

## 링크

- [YouTube](https://youtube.com/@touchizen)
- [Discord](https://discord.gg/DTMMs8TZDN)
- [웹사이트](https://touchizen.com)
