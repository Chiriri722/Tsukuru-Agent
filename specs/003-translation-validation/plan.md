# Implementation Plan: 번역 적용 무결성과 검증

**Branch**: `chore/hardening-integration` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

## Summary
D21-01부터 D21-07까지 순차 구현하고 D21-08 회귀를 각 단계에 포함한다.
사전 적용의 전체 rollback, Backup에 결합한 공통 lint, 공개 전 출력 검사를 공유 경계에 둔다.
이전 feature 002 및 main 최신 문서 커밋을 보존한다.

## Technical Context
**Language/Version**: TypeScript 5.5, Node.js 22/24 (로컬 24.14).
**Primary Dependencies**: 기존 fs, js-yaml, fast-csv, @electron/asar. 새 의존성 없음.
**Storage**: 로컬 Extract/Backup/.extracteddata/Completed, v1/v2 manifest.
**Testing**: node:test, 기존 verify/order/benchmark, Windows Electron smoke.
**Target Platform**: Windows 주 검증, Linux 계약 회귀 유지.
**Project Type**: CLI + Electron GUI 공통 서비스.
**Performance Goals**: 기존 benchmark:check 예산 유지; 충돌/품질 진단 상세 최대 100개.
**Constraints**: private corpus 미추적, 기본 원본 보존, 실패 시 부분 설치 없음.
**Scale/Scope**: D21 P0–P2와 브랜치 통합, 안내서 기반 실제 내부 검증. 의미 감수/게임 플레이 자동 보증 제외.

## Constitution Check
설계 전/후 모두 통과: 원본 보존·계약 호환·RED 회귀·독립 조사/후보 리뷰·재현 증거·최소 데이터 노출.
새 실험 엔진/의존성/원격 전송 없음. 파일 시스템 mutation은 기존 원자적 교체 도우미를 확장해 처리한다.

## Project Structure
- `tsukuru-agent/src/cli/operations/apply.ts`: 사전 적용 조정 및 결과 전달.
- `tsukuru-agent/src/cli/patcher.ts`: 전체 해시 사전 검사와 공유 lint.
- `tsukuru-agent/src/core/atomic.ts`: 관련 artifact 교체/복구.
- `tsukuru-agent/src/core/translationLint.ts`: 순수 토큰/품질 진단.
- `tsukuru-agent/src/js/rpgmv/applyPlan.ts`: 원문 결합/오류 문맥.
- `tsukuru-agent/src/js/rpgmv/RpgMakerService.ts`: 공유 적용 경계.
- `tsukuru-agent/src/core/validation/engines/rpg.ts`: 구조 검사와 파싱 후보 정책.
- `tsukuru-agent/test/integration/rpg-translation-validation.test.js`: 경계 회귀.
- `specs/003-translation-validation/`: 명세, 설계, 작업, 검증 증거.
