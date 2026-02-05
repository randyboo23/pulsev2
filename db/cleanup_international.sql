-- Remove articles that appear to be non-US only.
-- This is a best-effort cleanup based on title/summary keyword matching.
-- Review before running in production.

with candidates as (
  select id
  from articles
  where (
    lower(coalesce(title, '') || ' ' || coalesce(summary, '')) like any (array[
      '%jordan%','%canada%','%ontario%','%british columbia%','%uk%','%united kingdom%','%england%','%scotland%','%wales%','%ireland%',
      '%australia%','%new zealand%','%india%','%china%','%japan%','%korea%','%singapore%','%uae%','%saudi%','%qatar%',
      '%brazil%','%mexico%','%france%','%germany%','%spain%','%italy%','%netherlands%','%sweden%','%norway%','%finland%',
      '%denmark%','%belgium%','%switzerland%','%austria%','%poland%','%czech%','%slovakia%','%hungary%','%romania%',
      '%bulgaria%','%greece%','%turkey%','%israel%','%palestine%','%gaza%','%ukraine%','%russia%','%nigeria%',
      '%kenya%','%south africa%','%ghana%','%egypt%','%morocco%','%algeria%','%tunisia%','%ethiopia%','%pakistan%',
      '%bangladesh%','%sri lanka%','%nepal%','%philippines%','%indonesia%','%malaysia%','%thailand%','%vietnam%',
      '%cambodia%','%laos%','%myanmar%','%hong kong%','%taiwan%','%macau%','%european union%','%eu%'
    ])
  )
  and not (
    lower(coalesce(title, '') || ' ' || coalesce(summary, '')) like any (array[
      '%united states%','%u.s.%','%usa%','%district of columbia%','%washington, dc%',
      '%alabama%','%alaska%','%arizona%','%arkansas%','%california%','%colorado%','%connecticut%','%delaware%',
      '%florida%','%georgia%','%hawaii%','%idaho%','%illinois%','%indiana%','%iowa%','%kansas%','%kentucky%',
      '%louisiana%','%maine%','%maryland%','%massachusetts%','%michigan%','%minnesota%','%mississippi%','%missouri%',
      '%montana%','%nebraska%','%nevada%','%new hampshire%','%new jersey%','%new mexico%','%new york%',
      '%north carolina%','%north dakota%','%ohio%','%oklahoma%','%oregon%','%pennsylvania%','%rhode island%',
      '%south carolina%','%south dakota%','%tennessee%','%texas%','%utah%','%vermont%','%virginia%',
      '%washington state%','%west virginia%','%wisconsin%','%wyoming%'
    ])
  )
),
del_story_articles as (
  delete from story_articles
  using candidates
  where story_articles.article_id = candidates.id
  returning 1
),
del_articles as (
  delete from articles
  using candidates
  where articles.id = candidates.id
  returning 1
),
del_stories as (
  delete from stories
  where id not in (select distinct story_id from story_articles)
  returning 1
)
select
  (select count(*) from del_story_articles) as deleted_story_articles,
  (select count(*) from del_articles) as deleted_articles,
  (select count(*) from del_stories) as deleted_stories;
