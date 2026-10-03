# LoL rank emblems

Original compact rank glyphs, not profile-border/regalia crest assemblies.
Downloaded from CommunityDragon on 2026-10-04:

https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/

Iron, Bronze, Silver, Gold, Platinum, Diamond, Master, Grandmaster and Challenger
use the unchanged original 80x80 PNG files. Emerald's original `emerald.svg`
is included and was rasterized to 80x80 PNG using @resvg/resvg-js 2.6.2.
Artwork belongs to Riot Games.

Replacement first creates a new emblem, renames the existing border to
`lol_border_backup_<tier>`, then adopts the normal `lol_rank_<tier>` name.
No champion emoji is changed. Existing IDs/messages are not destroyed, and a
retry resumes any incomplete rename without reuploading completed emblems.
