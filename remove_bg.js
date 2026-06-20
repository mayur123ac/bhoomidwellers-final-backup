const Jimp = require('jimp');

async function removeWhiteBg(inputPath, outputPath) {
  try {
    const img = await Jimp.read(inputPath);
    
    img.scan(0, 0, img.bitmap.width, img.bitmap.height, function(x, y, idx) {
      const red = this.bitmap.data[idx + 0];
      const green = this.bitmap.data[idx + 1];
      const blue = this.bitmap.data[idx + 2];
      
      // Calculate how close the color is to pure white
      // Distance from white
      const rDist = 255 - red;
      const gDist = 255 - green;
      const bDist = 255 - blue;
      const dist = Math.sqrt(rDist*rDist + gDist*gDist + bDist*bDist);
      
      // If it's very close to white (threshold 20 out of 441 max distance)
      if (dist < 30) {
        // Completely transparent
        this.bitmap.data[idx + 3] = 0;
      } else if (dist < 80) {
        // Partially transparent for anti-aliasing edges
        // Closer to white = more transparent
        // dist=30 -> alpha=0
        // dist=80 -> alpha=255
        const alpha = Math.floor(((dist - 30) / 50) * 255);
        this.bitmap.data[idx + 3] = alpha;
        
        // Also darken the color slightly so it doesn't leave a bright white halo on dark background
        // Wait, if we keep the original color but lower alpha, it will blend as white
      }
    });
    
    await img.writeAsync(outputPath);
    console.log(`Successfully removed background for ${inputPath} -> ${outputPath}`);
  } catch (err) {
    console.error(`Error processing ${inputPath}:`, err);
  }
}

removeWhiteBg('public/assets/BhoomiWord.png', 'public/assets/BhoomiWord_trans.png');
removeWhiteBg('public/assets/logobrowser.png', 'public/assets/logobrowser_trans.png');
