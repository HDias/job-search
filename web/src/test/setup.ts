import '@testing-library/jest-dom/vitest';

// jsdom does not implement `Blob.text()`; the app reads uploaded text files with
// it, so the test environment shims the standard method via FileReader.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
