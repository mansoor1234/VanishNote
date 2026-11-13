/** One publication clock shared by routes, lists and the sitemap. Dates include an offset. */
export function isPublished(post: { data: { published: Date } }, now = Date.now()): boolean {
  return post.data.published.valueOf() <= now;
}
