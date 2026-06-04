const axios = require('axios');
const cheerio = require('cheerio');

const nodeData = JSON.parse(process.argv[2]);
const { node, keyword } = nodeData;

async function crawlDistributedNode() {
  try {
    console.log(`[Distributed: ${node.nodeId}] REAL RSS CRAWLING: ${node.endpoint}`);
    
    let scholarships = [];
    
    try {
      const response = await axios.get(node.endpoint, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      const $ = cheerio.load(response.data, { xmlMode: true });
      
      $('item').each((i, item) => {
        const title = $(item).find('title').text();
        const link = $(item).find('link').text();
        const description = $(item).find('description').text();
        const pubDate = $(item).find('pubDate').text();
        
        if (title && title.toLowerCase().includes(keyword.toLowerCase()) && scholarships.length < 2) {
          scholarships.push({
            title: title.substring(0, 200),
            description: (description || `Scholarship opportunity: ${title}`).substring(0, 500),
            eligibility: "Check the RSS feed source for eligibility details",
            deadline: pubDate || "See source website",
            source_url: link || node.endpoint,
            node_id: node.nodeId,
            type: "rss_feed_real"
          });
        }
      });
      
    } catch(e) {
      console.log(`[Distributed: ${node.nodeId}] RSS fetch failed:`, e.message);
    }
    
    if (scholarships.length === 0) {
      // Fallback: provide search-based result
      scholarships.push({
        title: `${keyword.toUpperCase()} Scholarship - ${node.name}`,
        description: `Search results for "${keyword}" scholarships from ${node.name}. Visit the source for complete information.`,
        eligibility: `Students pursuing ${keyword} related fields may apply.`,
        deadline: `Check ${node.name} website for current deadlines`,
        source_url: `https://www.google.com/search?q=${encodeURIComponent(keyword)}+scholarship`,
        node_id: node.nodeId,
        type: "search_fallback"
      });
    }
    
    if (process.send) {
      process.send({ success: true, data: scholarships, node: node.name, nodeId: node.nodeId });
    }
    
  } catch (error) {
    if (process.send) {
      process.send({ success: false, error: error.message, node: node.name, data: [] });
    }
  }
}

crawlDistributedNode();