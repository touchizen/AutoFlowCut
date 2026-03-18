/**
 * English strings
 */

export default {
  // App name
  appName: 'AutoFlowCut',
  
  // Header
  header: {
    export: 'Export CapCut',
    settings: 'Settings',
    login: 'Login',
    authenticated: 'Authenticated',
    checking: 'Checking...',
    waitingLogin: 'Waiting for login...',
    language: 'Language',
    menu: 'Menu',
  },
  
  // Welcome screen
  welcome: {
    title: 'AutoFlowCut',
    description: 'Generate images & videos with Flow AI\nand export to CapCut projects',
    openFlow: 'Open Flow',
    waitingLogin: 'Waiting for login...',
    loginHint: 'Login in Flow to continue automatically',
    checking: 'Checking authentication...',
  },
  
  // Tabs
  tabs: {
    text: 'Image',
    videoText: 'Video',
    frameToVideo: 'F→V',
    refToVideo: 'R→V',
    list: 'Scenes',
    import: 'Import',
    references: 'References',
    audio: 'Audio',
  },

  // Frame to Video panel
  frameToVideo: {
    title: 'Frame to Video',
    description: 'Select image scenes to generate videos',
    startImage: 'Start Image',
    endImage: 'End Image',
    prompt: 'Prompt',
    status: 'Status',
    noEndImage: '— None',
    addRow: '+ Add Row',
    removeRow: 'Remove',
    noScenesWithMedia: 'Generate images first (mediaId required)',
    generate: 'Generate Video',
    waiting: 'Waiting',
    generating: 'Generating',
    complete: 'Complete',
    error: 'Error',
    imagePrompt: '🖼️ Image Prompt',
    videoPromptLabel: '🎬 Video Prompt',
    noPrompt: '✏️ Custom',
    promptPlaceholder: 'Image generation prompt...',
    videoPromptPlaceholder: 'Video tab prompt...',
    customPromptPlaceholder: 'Type your own prompt...',
    autoBatch: '⚡ Auto Batch',
    autoBatchHint: 'Auto-create frame pairs from all available image scenes',
    clickToDetail: 'Click to view details',
  },

  // Refs to Video panel
  refToVideo: {
    title: 'References to Video',
    description: 'Combine references to generate videos',
    references: 'References (max 3)',
    prompt: 'Prompt',
    status: 'Status',
    addRow: '+ Add Row',
    removeRow: 'Remove',
    noRefsWithMedia: 'Upload references first (mediaId required)',
    selectRefs: 'Select references...',
    maxRefs: 'Up to 3 references',
    generate: 'Generate Video',
    waiting: 'Waiting',
    generating: 'Generating',
    complete: 'Complete',
    error: 'Error',
    promptPlaceholder: 'Video prompt...',
  },

  // Prompt input
  prompt: {
    placeholder: `Enter prompts (one per line)

Example:
A king sitting on a golden throne in a palace
The queen enters the throne room gracefully
The king and queen discuss important matters`,
    count: '{count} prompts',
    tip: 'Tip: Each line becomes a scene',
    videoPlaceholder: `Enter video prompts (one per line)

Example:
A drone shot slowly rising over a misty mountain forest at sunrise
A cat jumping from shelf to shelf in a cozy bookstore, slow motion
Ocean waves crashing against a lighthouse during a dramatic storm`,
  },
  
  // Scene list
  sceneList: {
    empty: 'No prompts yet.',
    emptyHint: 'Enter text in the Text tab or Import a file.',
    total: '{count} scenes / {duration}',
    addScene: '+ Add Scene',
    clearAll: 'Clear All',
    clearConfirm: 'Delete all scenes?\nThis cannot be undone.',
    time: 'Time(s)',
    promptCol: 'Prompt / Subtitle',
    subtitle: 'Subtitle',
    subtitlePlaceholder: 'Enter subtitle...',
    tags: 'Match Tags',
    media: 'Media',
    image: 'Image',
    character: 'Character',
    background: 'Background',
    style: 'Style',
    durationTitle: 'Duration (sec)',
    characterTitle: 'Character tag (for reference matching)',
    backgroundTitle: 'Background tag',
    styleTitle: 'Style tag',
    tagLegend: 'Reference match:',
    tagMatched: 'Yes',
    tagUnmatched: 'No',
    batchStyleTag: 'Batch Style Tag',
    batchApply: 'Batch Apply',
    applyStyle: 'Apply',
    applyTag: 'Apply',
    sceneUnit: ' scenes',
    range: 'Range',
    allScenes: 'All',
    noStyleRef: 'No style references. Add one in the Ref tab.',
    noRefForType: 'No {type} references. Add one in the Ref tab.',
  },
  
  // Reference
  reference: {
    title: 'Reference Images',
    hint: 'Auto-applied when tag matches scene',
    hintCollapsed: 'Click to expand',
    add: 'Add',
    upload: 'Click to upload',
    uploading: 'Uploading...',
    uploadedToFlow: 'Uploaded to Flow',
    name: 'Name',
    namePlaceholder: 'Name (for tag matching)',
    character: 'Character',
    scene: 'Scene',
    style: 'Style',
    generate: 'Generate',
    generating: 'Generating...',
    generateAll: 'Generate All',
    stop: 'Stop',
    stopping: 'Stopping',
    preparing: 'Preparing...',
    clearImage: 'Clear Image Only',
    removeCard: 'Remove Card',
    noStyle: 'No Style',
    styleRefHint: 'Select style reference to apply during generation',
    batchWizardTitle: 'Batch Generate',
    batchStyle: 'Style',
    batchCount: 'References to generate: {count}',
    batchStart: 'Start',
    detail: 'Detail',
    type: 'Type',
    prompt: 'Prompt',
    promptPlaceholder: 'Enter prompt for image generation',
    clickToEdit: 'Click to edit',
    clickToChange: 'Click to change',
    caption: 'Caption',
    captionHelp: 'Auto-generated image description by Flow. Sent with image generation requests to improve quality.',
    selectStyle: 'Select Style',
    styleTextOnly: 'Style uses prompt only, no image required',
    autoFilled: 'auto-filled',
    history: 'History',
    regenerate: 'Regenerate',
    clearAll: 'Clear All',
    clearConfirm: 'Delete all references?\nThis cannot be undone.',
    allCategories: 'All',
    uploadedStyles: 'Uploaded Styles',
    generateThumbnails: 'Generate Thumbnails',
    thumbnailProgress: 'Generating {current}/{total}',
    thumbnailComplete: 'Thumbnails generated',
    thumbnailStopped: 'Thumbnail generation stopped',
  },
  
  // Action buttons
  actions: {
    start: 'Start Generation',
    pause: 'Pause',
    resume: 'Resume',
    stop: 'Stop',
    close: 'Close',
    retryErrors: 'Retry Errors',
    retryOne: 'Retry',
    exportCapcut: 'CapCut Export',
    scenesComplete: '{done}/{total} scenes complete',
  },

  // Config (removed: aspectRatio, seed, method — now set directly in Flow UI)
  config: {
  },
  
  // Status
  status: {
    ready: 'Ready',
    running: 'Running',
    paused: 'Paused',
    done: 'Done!',
    stopped: 'Stopped',
    error: 'Error',
    pending: 'Pending',
    generating: 'Generating',
    checkingAuth: 'Checking authentication...',
    checkingFolder: 'Checking work folder...',
    uploadingRefs: 'Uploading references... ({current}/{total})',
    generatingScene: 'Generating: {ids} ({current}/{total})',
    retrying: 'Retrying: {id} ({count}/{max})',
    loginRequired: 'Login required - Please open labs.google tab',
    folderNotSet: 'Please select work folder in Settings',
    folderPermission: 'Work folder permission required',
    folderPermissionStopped: 'Work folder permission required. Generation stopped.',
    authErrorStopped: 'Auth error. Please login to Flow and try again.',
    stopping: 'Stopping...',
    resuming: 'Resuming...',
    collectingResults: 'Collecting results... ({remaining} remaining)',
  },
  
  // Results table
  results: {
    empty: 'Enter prompts and start generation',
    prompt: 'Prompt',
    image: 'Image',
    video: 'Video',
    videoPreview: 'Video Preview',
    status: 'Status',
    clearMedia: 'Clear Media',
  },

  // Settings
  settings: {
    title: 'Settings',
    save: 'Save',
    cancel: 'Cancel',
    
    // Tabs
    tabStorage: 'Storage',
    tabGeneration: 'Generation',
    tabScene: 'Scene',
    tabDisplay: 'Display',
    tabMcp: 'MCP',
    mcpApiDocsHint: 'View API documentation in Swagger UI',
    
    // Image save
    imageSave: 'Image Save',
    saveMode: 'Save Mode',
    saveAuto: 'Auto',
    saveAutoDesc: 'Save to work folder',
    saveFlow: 'Flow',
    saveFlowDesc: 'No local save',
    workFolder: 'Work Folder',
    selectFolder: 'Select Folder',
    changeFolder: 'Change Folder',
    requestPermission: 'Request Permission',
    folderNotSelected: 'No folder selected',
    folderDeleted: 'Folder deleted',
    folderDeletedDesc: 'Work folder has been deleted or moved. Please select again.',
    folderRequired: 'Select a work folder to enable image saving and project management',
    permissionGranted: 'Permission granted',
    permissionNeeded: 'Permission needed',
    // Project
    project: 'Project',
    projectNote: 'Images, references etc. will be saved in project folder',
    noProjects: 'No projects',
    createProject: 'New Project',
    projectNamePlaceholder: 'Project name (auto-generate if empty)',
    create: 'Create',
    renameProject: 'Rename',
    invalidProjectName: 'Project name contains invalid characters',
    projectExists: 'A project with this name already exists',
    renameFailed: 'Rename failed',
    
    // Image generation (simplified — all settings in Flow UI)
    generationInfo: 'Image generation uses Flow UI automation. Set aspect ratio and other options directly in the Flow panel.',
    
    // Scene settings
    sceneSettings: 'Scene Settings',
    defaultDuration: 'Default Duration',
    seconds: 'sec',
    projectName: 'Project Name',
    exportThreshold: 'Export Button Display Threshold',
    exportThresholdHint: 'Show export button when this percentage of scenes complete successfully',

    // Batch count
    batchSettings: 'Batch Generation',
    imageBatchCount: 'Image Batch Count',
    imageBatchHint: 'Number of images to generate per request in Flow',
    videoBatchCount: 'Video Batch Count',
    videoBatchHint: 'Number of videos to generate per request in Flow',

    // Image upscale
    imageUpscaleSettings: 'Image Upscale',
    imageUpscale: 'Upscale Resolution',
    imageUpscaleHint: 'Auto-upscale after image generation (default: 2K)',
    imageUpscaleOff: 'OFF',
    imageUpscale2k: '2K',
    imageUpscale4k: '4K',

    // Video download
    videoDownloadSettings: 'Video Download',
    videoResolution: 'Download Resolution',
    videoResolutionHint: 'Upscale resolution for video download (default: 1080p)',

    // MCP HTTP Server
    mcpHttpSettings: 'MCP Integration',
    mcpHttpEnabled: 'HTTP Server',
    mcpHttpPort: 'Port Number',
    mcpHttpHint: 'Allow external MCP servers to directly modify references and scene data.',

    // Display layout
    layoutMode: 'Layout',
    layoutTab: 'Tab Switch',
    layoutSplitLeft: 'Flow Left',
    layoutSplitRight: 'Flow Right',
    layoutSplitTop: 'Flow Top',
    layoutSplitBottom: 'Flow Bottom',
    splitRatio: 'Flow Ratio',
    layoutDomHint: 'Tab mode is not available in DOM mode because Flow view is required.',
  },
  
  // Import modal
  import: {
    title: 'Import File',
    close: 'Close',
    modeImage: 'Image',
    modeVideo: 'Video',
    selectFormat: 'Select file format',
    textTab: 'Text',
    csvTab: 'CSV',
    srtTab: 'SRT',
    textTitle: 'Prompt Text File',
    textDesc: 'Prompts separated by newlines',
    textHint: 'Each line = one scene',
    csvTitle: 'Scene CSV File',
    csvDesc: 'Structured scene data',
    csvExample: 'CSV Example',
    srtTitle: 'Subtitle SRT File',
    srtDesc: 'Auto-generate scenes from subtitles',
    srtHint: 'Timecode + subtitle → prompt',
    refTitle: 'Reference CSV File',
    refDesc: 'Define characters/scenes/styles',
    refExample: 'Reference Example',
    textPlaceholder: 'Paste prompts (one per line)',
    csvPlaceholder: 'Paste CSV content\n\nRequired: prompt\nOptional: subtitle, characters, scene_tag, style_tag, duration',
    srtPlaceholder: 'Paste SRT subtitle content',
    fileSelect: 'Or select file',
    import: 'Import',
    // Guide link buttons
    guide: 'Guide',
    sample: 'Sample',
    aiPrompt: 'AI Gen',
    guideTooltip: 'View usage guide',
    sampleTooltip: 'Download sample file',
    aiPromptTooltip: 'How to generate with AI',
    wrongTypeReference: 'This file is a Reference CSV.\nImport as Reference instead?',
    wrongTypeScene: 'This file is a Scene CSV.\nImport as Scene instead?',
    wrongTypeSrt: 'This file is an SRT subtitle file.\nImport as SRT instead?',
    wrongTypeCsv: 'This file is a CSV file.\nImport as Scene CSV instead?',
    wrongTypeText: 'This file is plain text.\nImport as prompts instead?',
    audioTitle: 'Audio Package',
    audioDesc: 'Voice + SFX for CapCut multitrack',
    audioHint: 'media/ + voice_samples/ + sfx/',
  },

  // Audio Import
  audioImport: {
    electronRequired: 'Available only in Electron desktop version.',
    scanFailed: 'Audio package scan failed: {error}',
    scanSuccess: 'Audio package loaded!\nCharacters: {characters}\n{voiceCount} voice files, {sfxCount} SFX categories',
  },

  // Audio Result Modal
  audioResult: {
    title: 'Audio Package Scan Result',
    confirm: 'OK',
    characters: 'Characters',
    voiceFiles: 'Voice Files',
    sfxCategories: 'SFX Categories',
    media: 'Media',
    srt: 'Subtitle',
    voiceDetail: 'Voices by Character',
    sfxDetail: 'SFX Details',
    mediaDetail: 'Media Files',
    files: 'files',
    voicesInMedia: 'In media',
    sfxTimecodes: 'SFX Timecodes',
    srtPreview: 'Subtitle Preview',
    more: 'more',
    sort_character: 'Name',
    sort_timecode: 'Time',
    sort_count: 'Count',
    scanning: 'Scanning audio package...',
    thTime: 'Time',
    thCharacter: 'Character',
    thFile: 'File',
    thCategory: 'Category',
    sort_sfx_category: 'Category',
    sort_sfx_name: 'Name',
    sort_sfx_timecode: 'Time',
  },

  audioTab: {
    title: 'Audio',
    importFirst: 'Import audio package first',
    summary: 'Summary',
    timeline: 'Timeline',
    flagFile: 'Flag as inappropriate',
    flagReasonPlaceholder: 'Reason (e.g., doorbell sound, not suitable for historical drama)',
    flagSave: 'Save',
    flagCancel: 'Cancel',
    flagRemove: 'Remove flag',
    flagged: 'Flagged',
    refresh: 'Refresh',
    refreshDesc: 'Reload the review file (.audio_review.json) to update flagged status.',
    srtMatch: 'Subtitle',
    sceneContent: 'Scene',
    typeVoice: 'Voice',
    typeSfx: 'SFX',
  },

  // History
  history: {
    title: 'History',
    empty: 'No generated images',
    clearAll: 'Clear All',
    detail: 'Details',
    date: 'Date',
    project: 'Project',
    file: 'File',
    aspectRatio: 'Aspect Ratio',
    prompt: 'Prompt',
    subtitle: 'Subtitle',
  },
  
  // Language
  language: {
    ko: '한국어',
    en: 'English',
  },
  
  // Export Modal
  exportModal: {
    title: 'Export to CapCut',
    capcutPackage: 'CapCut JSON Package',
    capcutPackageDesc: 'Project package for CapCut desktop/mobile',
    zipDesc: 'ZIP file containing images and timeline information',
    output: 'Output:',
    username: 'System Username',
    usernameRequired: 'Please enter your system username.',
    usernameHintMac: 'Check with whoami command in Terminal',
    usernameHintWin: 'CMD: whoami → Enter only the user part from COMPUTER\\user',
    projectNumber: 'CapCut Project Number',
    projectNumberRequired: 'Please enter CapCut project number.',
    projectNumberPlaceholder: 'e.g., 0128, 0201',
    projectNumberHint: 'CapCut project folder name (4-digit number)',
    generatedPath: 'Generated Path:',
    pathPresetCustom: 'Custom',
    customPathPlaceholder: 'Enter full project path...',
    scaleMode: 'Image Scale',
    scaleFill: 'Fill frame (may crop)',
    scaleFit: 'Fit entire image (may add bars)',
    scaleNone: 'Original size (100%)',
    scaleFillHint: 'Image fills the entire frame. May crop edges if aspect ratio differs.',
    scaleFitHint: 'Entire image is visible. May add black bars if aspect ratio differs.',
    scaleNoneHint: 'Use original image size.',
    kenBurns: 'Ken Burns Effect',
    kenBurnsHint: 'Apply automatic zoom/pan animation to images',
    kenBurnsTooltip: 'Ken Burns Effect: Applies gradual zoom in/out or pan left/right/up/down animation to images. A technique used in documentaries and slideshows to add dynamic movement to static images.',
    kenBurnsModeRandom: 'Random',
    kenBurnsModePattern: 'Pattern',
    kenBurnsModeTooltip: 'Random: Move to completely random position/size each cycle\nPattern: Select from predefined zoom in, zoom out, pan patterns',
    kenBurnsCycle: 'Cycle:',
    kenBurnsCycleUnit: 'sec',
    kenBurnsCycleTooltip: 'Animation change cycle (seconds)',
    kenBurnsScale: 'Scale',
    kenBurnsScaleTooltip: 'Zoom effect range (multiplied by auto-scale, 100%~150% recommended)',
    includeSubtitle: 'Include Subtitles (SRT)',
    includeSubtitleHint: 'Include SRT subtitle file in ZIP.',
    importGuide: 'How to Export to CapCut:',
    guideBtn: 'Guide',
    importStep1: 'Extract ZIP file',
    importStep2: 'Copy project folder to CapCut folder',
    importStep3Path: 'Copy to the parent folder of the generated path above',
    importStep4: 'Restart CapCut and check project list',
    macPathSearch: 'Can\'t find the project folder? Run in Terminal:',
    macSearchCmd: 'find ~ -type d -name "com.lveditor.draft" 2>/dev/null',
    winPathSearch: 'Can\'t find the project folder? Run in CMD:',
    winSearchCmd: 'dir "com.lveditor.draft" /s /ad C:\\Users\\%USERNAME%',
    copyPathTooltip: 'Copy parent folder path. Paste in Explorer/Finder address bar to verify.',
    autoDownloadTip: 'To download without save dialog, go to Chrome Settings > Downloads > turn off "Ask where to save each file before downloading".',
    trialBadge: '{exports} exports/{days} days',
    upgradeBtn: 'Pro',
    cancel: 'Cancel',
    export: 'Export',
    exporting: 'Exporting...',
    preparingPackage: 'Preparing CapCut package...',
    pleaseWait: 'Please wait',
    launchingCapcut: 'Launching CapCut...',
    launchingHint: 'Check your project when CapCut opens',
  },

  // Paywall
  paywall: {
    loginRequired: 'Login Required',
    loginDescription: 'Please login to use CapCut export.',
    trialEnded: 'Free Trial Ended',
    trialEndedDesc: 'Your 5 exports and 7-day trial period have expired.',
    exportsUsed: 'Free Exports Used',
    exportsUsedDesc: 'You\'ve used all 5 free exports. ({days} days remaining)',
    periodExpired: 'Trial Period Expired',
    periodExpiredDesc: '7-day trial period has ended. ({exports} exports remaining)',
    upgradeTitle: 'Upgrade to Pro',
    upgradeDesc: 'Unlock unlimited exports and all features.',
    monthly: 'Monthly',
    yearly: 'Yearly',
    month: 'mo',
    year: 'yr',
    feature1: 'Unlimited CapCut Exports',
    feature2: 'Ken Burns Effect (Random/Pattern)',
    feature3: 'Auto Subtitle Insertion',
    feature4: 'Priority Support',
    upgradeBtn: 'Upgrade to Pro',
    processing: 'Processing...',
    later: 'Maybe Later',
    error: 'Could not open payment page. Please try again.',
  },

  // Subscription
  subscription: {
    expired: 'Trial period has expired',
    upgrade: 'Upgrade',
    upgradeToPro: '⭐ Upgrade to Pro',
    trial: 'Trial',
    expiredBadge: 'Expired',
    proActive: 'Pro Subscription',
    trialRemaining: '{exports} exports / {days} days left',
    trialExpired: 'Trial expired',
    manageSubscription: 'Manage Subscription',
    loadingPortal: 'Loading...',
    logout: 'Logout',
    proBadge: 'PRO',
  },

  // Auth Modal
  auth: {
    title: 'AutoFlowCut',
    subtitle: 'Login and start your free trial',
    feature1: 'Export to CapCut project',
    feature2: 'Free trial: 5 exports or 7 days',
    feature3: 'Auto Ken Burns effect',
    loginButton: 'Continue with Google',
    loggingIn: 'Logging in...',
    loginFailed: 'Login failed.',
    termsNotice: 'By logging in, you agree to our Terms of Service.',
  },

  // Side Drawer
  drawer: {
    resources: 'Resources',
    flow: 'Google Flow',
    flowDesc: 'Create images & videos with AI',
    website: 'Website',
    websiteDesc: 'Official website & tutorials',
    youtube: 'YouTube',
    youtubeDesc: 'Video tutorials & tips',
    twitter: 'X (Twitter)',
    twitterDesc: 'Updates & announcements',
    discord: 'Discord',
    discordDesc: 'Community & support',
    docs: 'Documentation',
    docsDesc: 'User guide & API docs',
    feedback: 'Feedback',
    feedbackDesc: 'Report bugs & suggestions',
    madeWith: 'Made with',
    copyright: '© 2026 Touchizen',
  },

  // Common
  common: {
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    confirm: 'OK',
    delete: 'Delete',
    cancel: 'Cancel',
    save: 'Save',
    expand: 'Expand',
    collapse: 'Collapse',
    clickToRestore: 'Click to restore',
    copy: 'Copy',
    copied: 'copied',
    copyFailed: 'Copy failed',
  },

  // Scene detail modal
  sceneDetail: {
    cancel: 'Cancel',
    generating: '⏳ Generating...',
    regenerate: '🔄 Regenerate',
    save: 'Save',
    generatingStatus: 'Generating...',
    noImage: 'No image',
    prompt: 'Prompt',
    promptPlaceholder: 'Image generation prompt',
    subtitle: '💬 Subtitle',
    subtitlePlaceholder: 'Subtitle for video (optional)',
    startTime: 'Start Time',
    duration: 'Duration (sec)',
    character: '👤 Character',
    characterPlaceholder: 'Character name for reference matching (comma separated)',
    background: '🏞️ Background',
    backgroundPlaceholder: 'Background reference name',
    style: '🎨 Style',
    styleSelect: 'Select style...',
    styleNone: '(None)',
    history: '📜 History',
    exportMedia: 'Export Media',
    mediaImage: 'Image',
  },

  // Image history modal
  imageHistory: {
    title: '📜 Image History - {sceneId}',
    close: 'Close',
    currentImage: 'Current Image',
    currentBadge: 'In Use',
    loading: '⏳ Loading history...',
    previousVersions: 'Previous Versions ({count})',
    noPreviousVersions: 'No previous versions.',
    noPreview: 'No preview',
    restoring: 'Restoring...',
    useThisImage: 'Use this image',
    delete: 'Delete',
    deleteConfirm: 'Delete this history?',
    restoreFailed: 'Restore failed',
  },

  // Subscription hook
  subscriptionHook: {
    loginFirst: 'Login and start your free trial',
    proActive: 'Pro subscription active',
    trialExpired: 'Trial period has expired',
    trialInfo: 'Free trial: {exports} exports / {days} days left',
    loginRequired: 'Login is required to use export.',
    trialExpiredUpgrade: 'Free trial has expired. Upgrade to Pro.',
  },

  // Scenes hook
  scenesHook: {
    duplicateRefConfirm: 'References with the same name exist:\n{names}\n\nUpdate existing references?\n(Cancel: Skip duplicates)',
  },

  // Header extra
  headerExtra: {
    clickToDetail: 'Click to view details',
    cannotChangeProject: 'Cannot change project during generation',
  },

  // Export modal extra
  exportModalExtra: {
    pathRequired: 'Export path is required.',
    autoDetected: 'auto-detected',
    capcutNotInstalled: 'CapCut is not installed. Would you like to download it?',
  },

  // CapCut Cloud
  capcutCloud: {
    projectPathRequired: 'CapCut project folder path is required.',
  },

  // Toast messages
  toast: {
    noPrompt: 'No prompt provided.',
    allScenesGenerated: 'All scenes already generated. Use regenerate on individual scenes.',
    allRefsGenerated: 'All references already generated.',
    permissionReleasedMemory: 'Permission released. Storing in memory... Will save after completion.',
    generateFailed: 'Generation failed: {error}',
    generateError: 'Generation error: {error}',
    serverErrorRetry: 'Server error, retry {retry}/3...',
    batchStopped: 'Batch generation stopped by user.',
    serverErrorPersist: 'Server error persists. Stopping.',
    tokenRefreshing: 'Refreshing token...',
    authErrorStop: 'Auth error. Stopping. Please login to Flow and try again.',
    batchCompleteNeedPermission: 'Generation complete! Please allow permission to save.',
    folderDeleted: 'Work folder has been deleted. Please select again.',
    folderPermissionNeeded: 'Work folder permission required.',
    folderSelectFirst: 'Please select work folder first.',
    flowLoginRequired: 'Flow login required. Please login at labs.google tab.',
    flowLoginExpiredTitle: 'Flow Login Expired',
    flowLoginExpiredMessage: 'Your Flow session has expired. Please log in again in the Flow tab on the left.',
    memoryWarning: 'High memory usage. Some images may not be saved.',
    memoryCritical: 'Out of memory. Stopping. Please allow save permission in settings.',
    noGeneratedImages: 'No generated images.',
    filePermissionRequired: 'File read permission required. Please allow in Settings.',
    exportSaveComplete: 'CapCut project saved!',
    exportCapcutLaunched: 'CapCut launched. Check your project!',
    exportCapcutFailed: 'Failed to launch CapCut. Please open manually.',
    exportFailed: 'Export failed: {error}',
    sceneGenerateSuccess: 'Scene {sceneId} generated successfully',
    sceneGenerateFailed: 'Generation failed: {error}',
    sceneGenerateError: 'Generation error: {error}',
    projectRenamed: 'Project renamed successfully.',
    copied: 'Copied!',
  },

  // Video Selection
  videoSelection: {
    selectAll: 'Select All',
    noneSelected: 'No items selected. Please select at least one item to generate.',
    selectedCount: 'Selected',
  },

  // Video Detail Modal
  videoDetail: {
    info: 'Info',
    path: 'Path',
  },

  // Detail common
  detail: {
    history: '📜 History',
  },

  // Video Automation
  videoAutomation: {
    requesting: 'Requesting video generation...',
    polling: 'Waiting for video generation...',
    generating: 'Generating video',
    downloading: 'Downloading video...',
    done: 'Video generation complete!',
    noItems: 'No items to generate.',
    stopped: 'Video generation stopped.',
  },

  // Tag Validation Modal
  tagValidation: {
    title: '⚠️ Tag Match Warning',
    summary: '{tagCount} tags in {sceneCount} scenes not matched with references',
    cancel: 'Cancel (Fix)',
    proceedAnyway: 'Proceed Anyway',
  },

  // Generation Queue
  queue: {
    full: 'Generation queue is full (5)',
  },
}
