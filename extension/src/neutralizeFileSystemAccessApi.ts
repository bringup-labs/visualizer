// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Neutralize the broken File System Access API inside the bringup extension webview.
 *
 * Constraint: the visualizer runs in a cross-origin webview iframe where
 * `window.showOpenFilePicker` EXISTS but throws a SecurityError when called. suite-base does no
 * feature detection — `@lichtblick/suite-base/util/showOpenFilePicker` calls
 * `window.showOpenFilePicker(options)` unconditionally and only tolerates "AbortError" (user
 * cancel), so simply deleting the property would just trade the SecurityError for a TypeError.
 *
 * Instead we replace `window.showOpenFilePicker` with a dependency-free `<input type="file">`
 * backed implementation that resolves FileSystemFileHandle-compatible objects (the shapes
 * suite-base consumes: `name`, `kind`, `getFile()`, `queryPermission()`, `requestPermission()`)
 * and rejects with a DOMException named "AbortError" on cancel — exactly what suite-base's
 * wrapper expects. Persisting these shim handles into the IndexedDB "recents" store fails
 * structured clone, but suite-base catches and logs that error (useIndexedDbRecents), so the
 * open-file flow itself is unaffected.
 */
export function neutralizeFileSystemAccessApi(): void {
  if (typeof window === "undefined") {
    return;
  }

  const inputBackedOpenFilePicker = async (
    options?: OpenFilePickerOptions,
  ): Promise<FileSystemFileHandle[]> => {
    return await new Promise<FileSystemFileHandle[]>((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = options?.multiple ?? false;
      input.style.display = "none";

      // Map the File System Access `types[].accept` records (MIME type -> extensions) onto the
      // input element's `accept` attribute.
      const extensions = (options?.types ?? []).flatMap((type) =>
        Object.values(type.accept ?? {}).flat(),
      );
      if (extensions.length > 0) {
        input.accept = extensions.join(",");
      }

      const cleanup = () => {
        input.remove();
      };

      input.addEventListener(
        "change",
        () => {
          const files = Array.from(input.files ?? []);
          cleanup();
          resolve(files.map((file) => makeFileHandle(file)));
        },
        { once: true },
      );

      // Chromium fires "cancel" on file inputs when the user dismisses the picker.
      input.addEventListener(
        "cancel",
        () => {
          cleanup();
          reject(new DOMException("The user aborted a request.", "AbortError"));
        },
        { once: true },
      );

      document.body.appendChild(input);
      input.click();
    });
  };

  // Cast: the WICG typings declare an overload returning a one-element tuple for
  // `multiple: false`; our single signature is call-compatible with both overloads.
  window.showOpenFilePicker = inputBackedOpenFilePicker as typeof window.showOpenFilePicker;
}

/** Wrap a File in the subset of FileSystemFileHandle that suite-base consumes. */
function makeFileHandle(file: File): FileSystemFileHandle {
  const handle = {
    kind: "file" as const,
    name: file.name,
    getFile: async () => file,
    queryPermission: async () => "granted" as const,
    requestPermission: async () => "granted" as const,
    isSameEntry: async (other: unknown) => other === handle,
  };
  return handle as unknown as FileSystemFileHandle;
}
