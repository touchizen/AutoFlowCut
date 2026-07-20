import { isSceneGenerationDone } from '../services/generationStatus'
import { hasExportableMedia } from './sceneMedia'

export function isExportableScene(scene) {
  return isSceneGenerationDone(scene) && hasExportableMedia(scene)
}
