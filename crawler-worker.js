const { parentPort, workerData } = require('worker_threads');
const axios = require('axios');
const cheerio = require('cheerio');

async function crawlRealWebsite(source, keyword, threadId) {
  try {
    console.log(`[Thread #${threadId}] REAL CRAWLING: ${source.name}`);
    
    const response = await axios.get(source.url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    const scholarships = [];
    const keywordLower = keyword.toLowerCase();
    
    // Try to find scholarship links
    let links = [];
    
    if (source.selector) {
      $(source.selector).each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr('href');
        if (title && title.length > 5 && title.length < 300) {
          links.push({ title, href });
        }
      });
    }
    
    // Fallback: find any links with scholarship keywords
    if (links.length === 0) {
      $('a').each((i, el) => {
        const text = $(el).text().toLowerCase();
        if (text.includes('scholarship') || text.includes('fellowship') || text.includes('grant')) {
          const title = $(el).text().trim();
          const href = $(el).attr('href');
          if (title && title.length > 5 && title.length < 300) {
            links.push({ title, href });
          }
        }
      });
    }
    
    // Filter by keyword and limit
    const filtered = links
      .filter(item => item.title.toLowerCase().includes(keywordLower))
      .slice(0, 3);
    
    for (const item of filtered) {
      let fullUrl = item.href;
      if (fullUrl && !fullUrl.startsWith('http')) {
        try {
          fullUrl = new URL(fullUrl, source.url).href;
        } catch(e) {
          fullUrl = source.url;
        }
      }
      
      scholarships.push({
        title: item.title.substring(0, 200),
        description: `Found on ${source.name}. Click source link for complete scholarship details.`,
        eligibility: "Check the source website for eligibility criteria and requirements.",
        deadline: "See source website for application deadline",
        source_url: fullUrl || source.url,
        thread_id: threadId,
        type: "real_data",
        source_name: source.name
      });
    }
    
    console.log(`[Thread #${threadId}] Found ${scholarships.length} real scholarships from ${source.name}`);
    parentPort.postMessage({ success: true, data: scholarships, source: source.name, threadId });
    
  } catch (error) {
    console.error(`[Thread #${threadId}] Error crawling ${source.name}:`, error.message);
    parentPort.postMessage({ success: false, error: error.message, source: source.name, threadId, data: [] });
  }
}

crawlRealWebsite(workerData.source, workerData.keyword, workerData.threadId);