const fs = require('fs')

const MACH_CPU_ARCH = new Map([
  [0x01000007, 'x64'],
  [0x0100000c, 'arm64'],
  [7, 'ia32'],
  [12, 'armv7l'],
])

const PE_MACHINE_ARCH = new Map([
  [0x8664, 'x64'],
  [0xaa64, 'arm64'],
  [0x014c, 'ia32'],
  [0x01c4, 'armv7l'],
])

const ELF_MACHINE_ARCH = new Map([
  [62, 'x64'],
  [183, 'arm64'],
  [3, 'ia32'],
  [40, 'armv7l'],
])

function normalizeArch(arch) {
  if (arch === 'amd64' || arch === 'x86_64') return 'x64'
  if (arch === 'aarch64') return 'arm64'
  return arch
}

function verifyBinaryArch(filePath, { platform, arch }) {
  try {
    const buffer = readHeader(filePath)
    const architectures = parseArchitectures(buffer, platform)
    return architectures.includes(normalizeArch(arch))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      const code = error?.code || error?.name || 'UNKNOWN'
      console.warn(
        `[verifyBinaryArch] failed to read ${filePath} (${code}): ${error?.message || error}`,
      )
    }
    return false
  }
}

function readHeader(filePath) {
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(64 * 1024)
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    fs.closeSync(descriptor)
  }
}

function parseArchitectures(buffer, platform) {
  if (platform === 'win32') return parsePeArchitectures(buffer)
  if (platform === 'linux') return parseElfArchitectures(buffer)
  if (platform === 'darwin') return parseMachArchitectures(buffer)
  return []
}

function parsePeArchitectures(buffer) {
  if (buffer.length < 0x40 || buffer.toString('ascii', 0, 2) !== 'MZ') return []
  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset + 6 > buffer.length || buffer.toString('binary', peOffset, peOffset + 4) !== 'PE\0\0') return []
  const arch = PE_MACHINE_ARCH.get(buffer.readUInt16LE(peOffset + 4))
  return arch ? [arch] : []
}

function parseElfArchitectures(buffer) {
  if (buffer.length < 20 || !buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return []
  const elfClass = buffer[4]
  const littleEndian = buffer[5] === 1
  if (![1, 2].includes(elfClass) || ![1, 2].includes(buffer[5])) return []
  const machine = littleEndian ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18)
  const arch = ELF_MACHINE_ARCH.get(machine)
  if (!arch) return []
  const expectedClass = arch === 'x64' || arch === 'arm64' ? 2 : 1
  return elfClass === expectedClass ? [arch] : []
}

function parseMachArchitectures(buffer) {
  if (buffer.length < 8) return []
  const magic = buffer.readUInt32BE(0)

  if (magic === 0xfeedface || magic === 0xfeedfacf) {
    return machCpuArch(buffer.readUInt32BE(4))
  }
  if (magic === 0xcefaedfe || magic === 0xcffaedfe) {
    return machCpuArch(buffer.readUInt32LE(4))
  }

  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    return parseFatMachArchitectures(buffer, false, magic === 0xcafebabf)
  }
  if (magic === 0xbebafeca || magic === 0xbfbafeca) {
    return parseFatMachArchitectures(buffer, true, magic === 0xbfbafeca)
  }
  return []
}

function parseFatMachArchitectures(buffer, littleEndian, is64Bit) {
  const read32 = littleEndian
    ? offset => buffer.readUInt32LE(offset)
    : offset => buffer.readUInt32BE(offset)
  const count = read32(4)
  const entrySize = is64Bit ? 32 : 20
  const architectures = new Set()

  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * entrySize
    if (offset + entrySize > buffer.length) return []
    const arch = MACH_CPU_ARCH.get(read32(offset))
    if (arch) architectures.add(arch)
  }
  return [...architectures]
}

function machCpuArch(cpuType) {
  const arch = MACH_CPU_ARCH.get(cpuType)
  return arch ? [arch] : []
}

module.exports = {
  normalizeArch,
  parseArchitectures,
  verifyBinaryArch,
}
