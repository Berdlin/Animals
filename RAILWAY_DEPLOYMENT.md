# Railway Deployment Guide for Feral Pursuit

## Prerequisites
- GitHub account
- Railway account (free tier available)
- Neon PostgreSQL database (already set up)

## Deployment Steps

### 1. Push Code to GitHub
```bash
git init
git add .
git commit -m "Initial commit for Railway deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/feral-pursuit.git
git push -u origin main
```

### 2. Create Railway Project
1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your `feral-pursuit` repository
5. Railway will automatically detect it's a Node.js project

### 3. Configure Environment Variables
In your Railway project dashboard, go to the "Variables" tab and add:

**Required Variables:**
- `DATABASE_URL` - Your Neon PostgreSQL connection string
  - Get this from your Neon dashboard
  - Format: `postgresql://user:password@host/database?sslmode=require`
  - Example: `postgresql://neondb_owner:xxx@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require`

**Optional Variables:**
- `NODE_ENV` - Set to `production`

### 4. Deploy
1. Railway will automatically deploy when you push to GitHub
2. Monitor the deployment logs in the Railway dashboard
3. Once deployed, Railway will provide a public URL

### 5. Verify Deployment
1. Visit your Railway URL (e.g., `https://your-app.railway.app`)
2. Test the health endpoint: `https://your-app.railway.app/api/health`
3. Should return: `{"status":"ok","database":"connected"}`

### 6. Socket.IO Configuration
Railway supports WebSockets out of the box. Your Socket.IO configuration in `server.js` is already compatible:
```javascript
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
```

## Important Notes

### Database Connection
- The hardcoded DATABASE_URL has been removed from `server.js`
- Railway will inject the DATABASE_URL from environment variables
- Make sure to add your Neon DATABASE_URL in Railway's Variables tab

### Port Configuration
- Your server already uses `process.env.PORT || 3000`
- Railway automatically assigns a port via the PORT environment variable
- No changes needed

### Static Files
- Your HTML, CSS, and client-side JS files are served via Express static middleware
- Railway will serve these correctly

### Free Tier Limits
- Railway free tier: $5/month credit (enough for small projects)
- After credit expires: $0.000522/GB-hour
- Sleeps after inactivity (wakes up on request)

## Troubleshooting

### Deployment Fails
- Check Railway deployment logs for errors
- Verify DATABASE_URL is set correctly
- Ensure all dependencies are in package.json

### Database Connection Issues
- Verify DATABASE_URL format
- Check Neon database is active
- Ensure SSL mode is enabled (required by Neon)

### Socket.IO Not Working
- Railway supports WebSockets by default
- Check CORS settings in server.js
- Verify client connects to correct Railway URL

## Updating Your App
After making changes:
```bash
git add .
git commit -m "Description of changes"
git push
```
Railway will automatically redeploy on push.

## Monitoring
- View logs in Railway dashboard
- Monitor resource usage
- Set up alerts (optional)

## Domain (Optional)
To use a custom domain:
1. Go to Railway project settings
2. Click "Domains"
3. Add your custom domain
4. Update DNS records as instructed
