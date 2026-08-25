/** notesSlide 允许非规范文件名；只约束它必须位于 notesSlides 目录且是 XML part。 */
export const isNotesPart = (part: string): boolean => /^ppt\/notesSlides\/[^/]+\.xml$/.test(part);
