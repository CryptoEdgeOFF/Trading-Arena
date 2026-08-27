export type LocalizedNewsFields = {
  title: string;
  summary: string;
  body: string;
  titleEn?: string;
  summaryEn?: string;
  bodyEn?: string;
};

export function localizeNews<T extends LocalizedNewsFields>(article: T, language?: string) {
  const english = Boolean(language?.startsWith('en'));
  return {
    ...article,
    title: english && article.titleEn ? article.titleEn : article.title,
    summary: english && article.summaryEn ? article.summaryEn : article.summary,
    body: english && article.bodyEn ? article.bodyEn : article.body,
  };
}
