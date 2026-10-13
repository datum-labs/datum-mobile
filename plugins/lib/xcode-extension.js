// Helpers for the local app-extension plugins (with-datum-vpn, with-datum-widgets).

const EMBED = 'Embed Foundation Extensions';

/**
 * node-xcode's addTarget('app_extension') gives the app a new "Copy Files"
 * phase per extension. Fold them into one phase named as Xcode names it, so
 * two extension plugins (in either order) leave a single embed phase.
 */
function consolidateEmbedPhases(project, appTargetUuid) {
  const objects = project.hash.project.objects;
  const copyPhases = objects.PBXCopyFilesBuildPhase ?? {};
  const target = objects.PBXNativeTarget[appTargetUuid];
  const embeds = target.buildPhases.filter((p) => copyPhases[p.value]?.dstSubfolderSpec === 13);
  if (embeds.length === 0) return;
  const [keep, ...rest] = embeds;
  const phase = copyPhases[keep.value];
  for (const extra of rest) {
    phase.files.push(...copyPhases[extra.value].files);
    delete copyPhases[extra.value];
    delete copyPhases[`${extra.value}_comment`];
  }
  target.buildPhases = target.buildPhases.filter((p) => !rest.some((r) => r.value === p.value));
  phase.name = `"${EMBED}"`;
  copyPhases[`${keep.value}_comment`] = EMBED;
  keep.comment = EMBED;
}

/** The app's own target (node-xcode's addTarget embeds into the first target, which is it). */
function appTarget(project) {
  return project.getFirstTarget();
}

/**
 * Add existing file references to a target's Sources phase as new build
 * files (node-xcode's addBuildPhase would reuse another target's).
 */
function addSourcesToTarget(project, targetUuid, fileNames) {
  const objects = project.hash.project.objects;
  const refs = project.pbxFileReferenceSection();
  const target = objects.PBXNativeTarget[targetUuid];
  const sourcesId = target.buildPhases.find((p) => objects.PBXSourcesBuildPhase?.[p.value])?.value;
  if (!sourcesId) throw new Error('xcode-extension: target has no Sources phase');
  const phase = objects.PBXSourcesBuildPhase[sourcesId];
  for (const name of fileNames) {
    const refId = Object.keys(refs).find(
      (key) => !key.endsWith('_comment') && String(refs[key].path).replace(/"/g, '') === name
    );
    if (!refId) throw new Error(`xcode-extension: no file reference for ${name}`);
    const already = phase.files.some((f) => objects.PBXBuildFile[f.value]?.fileRef === refId);
    if (already) continue;
    const uuid = project.generateUuid();
    objects.PBXBuildFile[uuid] = { isa: 'PBXBuildFile', fileRef: refId, fileRef_comment: name };
    objects.PBXBuildFile[`${uuid}_comment`] = `${name} in Sources`;
    phase.files.push({ value: uuid, comment: `${name} in Sources` });
  }
}

const xml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Entitlements plist: string-array values only. */
function entitlementsPlist(entries) {
  const body = Object.entries(entries)
    .map(
      ([key, values]) =>
        `\t<key>${xml(key)}</key>\n\t<array>\n${values.map((v) => `\t\t<string>${xml(v)}</string>\n`).join('')}\t</array>\n`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}</dict>\n</plist>\n`;
}

module.exports = { consolidateEmbedPhases, appTarget, addSourcesToTarget, entitlementsPlist, EMBED };
