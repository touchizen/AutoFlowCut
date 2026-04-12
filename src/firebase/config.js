/**
 * Firebase Configuration
 * Project: creator-tools
 *
 * Firebase 콘솔에서 프로젝트 생성 후 설정값을 입력하세요:
 * https://console.firebase.google.com/
 */

import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore, setLogLevel } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

// Firestore 내부 로그 레벨 설정 (WebChannel 에러 숨김)
setLogLevel('error')

// Firebase 설정 - creator-tools 프로젝트
// Chrome 확장 프로그램에서는 환경 변수 대신 직접 설정
const firebaseConfig = {
  apiKey: 'AIzaSyCQg1lhxu9wn_JiLIAX4Ta8jkH9pYF_6OY',
  authDomain: 'creator-tools-6bb8b.firebaseapp.com',
  projectId: 'creator-tools-6bb8b',
  storageBucket: 'creator-tools-6bb8b.firebasestorage.app',
  messagingSenderId: '906175994283',
  appId: '1:906175994283:web:7b2f56ea7855695aa35aee'
}

// Firebase 초기화
const app = initializeApp(firebaseConfig)

// 앱 ID (Firestore 경로에 사용 — 프로젝트 rename 전 ID를 유지해야 기존 데이터와 호환)
export const APP_ID = 'flow2capcut'

// Firebase 서비스 인스턴스
export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app)

export default app
