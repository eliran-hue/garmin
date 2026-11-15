# Garmin Dashboard

דשבורד אישי לנתוני Garmin. הנתונים נמשכים פעם ביום מה-Personal API הרשמי של Garmin דרך GitHub Actions, נשמרים ב-repo הזה (פרטי), והאתר מוגש מ-Cloudflare Pages מאחורי Cloudflare Access.

```
Garmin Personal API ──(כל בוקר)──▶ GitHub Actions ──commit──▶ repo ──▶ Cloudflare Pages ──▶ Cloudflare Access ──▶ אתה
```

## מבנה

| נתיב | מה יש שם |
|---|---|
| `scripts/fetch_garmin.py` | מושך את כל סוגי הנתונים (16 endpoints יומיים, אימונים, פרופיל ואזורי דופק) ושומר JSON גולמי |
| `scripts/build_dataset.py` | הופך את הגולמי לקבצים קטנים לדשבורד: `daily.json`, `activities.json`, `explorer.json`, `meta.json` |
| `scripts/make_sample_data.py` | נתונים מדומים לפיתוח בלי מפתח |
| `data/raw/` | הנתונים הגולמיים, קובץ לכל סוג נתון לכל יום (לא מוגש באתר) |
| `site/` | הדשבורד (HTML/JS בלי ספריות חיצוניות). זו התיקייה ש-Cloudflare מגיש |
| `.github/workflows/garmin-sync.yml` | הריצה היומית |

## התקנה (פעם אחת)

### 1. המפתח של Garmin ב-GitHub
1. ב-GitHub: **Settings → Secrets and variables → Actions → New repository secret**
2. שם: `GARMIN_API_KEY`, ערך: המפתח האישי מ-Garmin Connect.
3. מומלץ: בלשונית **Variables** של אותו מסך, צור משתנה `GARMIN_KEY_EXPIRES` עם תאריך התפוגה של המפתח (`YYYY-MM-DD`). שבועיים לפני שהמפתח פג, הריצה תיכשל ותקבל מייל.

### 2. משיכה ראשונה של היסטוריה
1. **Actions → Garmin sync → Run workflow**
2. ב-`days` הכנס `365` (או כמה שתרצה) והרץ. ריצה של שנה לוקחת בערך שעה.
3. אם היא נקטעת באמצע, מה שכבר נמשך נשמר. הרצה חוזרת ממשיכה מאיפה שעצרה.

מכאן והלאה הריצה היומית אוטומטית (בערך ב-09:17 שעון ישראל) ומושכת את 7 הימים האחרונים, כדי לתפוס גם סנכרונים מאוחרים של השעון.

### 3. Cloudflare Pages
1. ב-Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** ובחר את ה-repo `garmin`.
2. Framework preset: **None**. Build command: ריק. **Build output directory: `site`**
3. Save and Deploy. כל commit של הריצה היומית יעדכן את האתר אוטומטית.

### 3א. פריסה אוטומטית מה-Action (מומלץ)
כדי שכל ריצה יומית תפרוס את האתר מיד, הוסף שני secrets ב-GitHub:
- `CLOUDFLARE_API_TOKEN`: ב-Cloudflare: **My Profile → API Tokens → Create Token → Edit Cloudflare Workers** (תבנית מוכנה) → Create.
- `CLOUDFLARE_ACCOUNT_ID`: מופיע בעמוד **Workers & Pages** בצד ימין (Account ID), או בכתובת של הדשבורד אחרי `dash.cloudflare.com/`.

### 4. נעילת האתר עם Cloudflare Access (חובה, אלה נתוני בריאות)
1. ב-Cloudflare: **Zero Trust → Access → Applications → Add an application → Self-hosted**
2. Application domain: הכתובת של האתר (`<project>.pages.dev`). הוסף אפליקציה נוספת גם ל-`*.<project>.pages.dev` כדי לכסות את ה-preview deployments.
3. Policy: **Allow**, Include → **Emails** → המייל שלך.
4. שיטת התחברות: One-time PIN (קוד למייל) מספיקה.

החינמי של Zero Trust מכסה עד 50 משתמשים.

## פיתוח מקומי
```bash
GARMIN_ROOT=/tmp/garmin-sample python scripts/make_sample_data.py
GARMIN_ROOT=/tmp/garmin-sample python scripts/build_dataset.py
cp site/*.html site/*.css site/*.js /tmp/garmin-sample/site/
cd /tmp/garmin-sample/site && python -m http.server 8000
```
או עם מפתח אמיתי: `GARMIN_API_KEY=... python scripts/fetch_garmin.py --days 14 && python scripts/build_dataset.py`

## הערות
- ה-Personal API הוא קריאה בלבד. לפי דיווחים, Garmin לא מחזירים דרכו VO2 max, זמן התאוששות, performance condition ו-training effect. כל מה שכן מגיע מופיע בלשונית **כל הנתונים**.
- טוקן הגישה תקף ל-24 שעות, והסקריפט מבקש טוקן חדש בכל ריצה. המפתח עצמו תקף עד שנה.
- endpoint שמחזיר שגיאה (למשל סוג נתון שהשעון לא תומך בו) לא עוצר את הריצה.
