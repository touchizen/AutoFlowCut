const { execFileSync } = require("child_process");
const path = require("path");

// Certum SimplySign cloud code signing script for electron-builder
// Requires: SimplySign Desktop running + authenticated via TOTP
//
// Environment variables:
//   CERTUM_THUMBPRINT     - SHA1 thumbprint of the code signing certificate (required)
//   CERTUM_SKIP_SIGN      - Set to "true" to skip signing (dev builds)
//   CERTUM_TIMESTAMP_SERVER - Timestamp server URL (default: http://time.certum.pl)
//   SIGNTOOL_PATH         - Path to signtool.exe (auto-detected)

const SIGNTOOL = process.env.SIGNTOOL_PATH ||
  "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe";
const TIMESTAMP_SERVER = process.env.CERTUM_TIMESTAMP_SERVER || "http://time.certum.pl";

exports.default = async function (configuration) {
  if (!configuration.path) return;

  if (process.env.CERTUM_SKIP_SIGN === "true") {
    console.log(`  [skip] ${path.basename(configuration.path)}`);
    return;
  }

  const thumbprint = process.env.CERTUM_THUMBPRINT;
  if (!thumbprint) {
    console.warn("  CERTUM_THUMBPRINT not set, skipping signing");
    return;
  }

  const filePath = configuration.path;
  const fileName = path.basename(filePath);
  console.log(`  [sign] ${fileName}`);

  // Use execFileSync to pass arguments as array (avoids shell escaping issues)
  const args = [
    "sign",
    "/sha1", thumbprint,
    "/fd", "SHA256",
    "/tr", TIMESTAMP_SERVER,
    "/td", "SHA256",
    "/v",
    filePath,
  ];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execFileSync(SIGNTOOL, args, { stdio: "inherit", timeout: 60000 });
      return;
    } catch (e) {
      if (attempt < 3) {
        console.log(`  [retry ${attempt}/3] ${fileName}`);
        // Wait 2 seconds before retry
        const wait = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
        wait(2000);
      } else {
        throw new Error(`Signing failed after 3 attempts: ${fileName}\n${e.message}`);
      }
    }
  }
};
