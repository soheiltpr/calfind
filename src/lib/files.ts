export const dataUrlToBuffer = (dataUrl: string) => {
  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid data URL");
  }
  const base64 = matches[2];
  return Buffer.from(base64, "base64");
};


