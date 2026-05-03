/**
 * Firebase Module Exports
 */

export { auth, db, functions } from './config'
export {
  signInWithGoogle,
  signOut,
  getCurrentUser,
  onAuthChange,
  getIdToken
} from './auth'
export {
  getUserDoc,
  getAppDoc,
  calculateTrialStatus,
  toDate
} from './firestore'
export {
  incrementExportCount,
  createCheckoutSession,
  createPortalSession,
  initializeUser
} from './functions'
