const { Jimp } = require('jimp');

async function removeWhiteBg(inputPath, outputPath) {
  try {
    const img = await Jimp.read(inputPath);
    
    img.scan(0, 0, img.bitmap.width, img.bitmap.height, function(x, y, idx) {
      const red = img.bitmap.data[idx + 0];
      const green = img.bitmap.data[idx + 1];
      const blue = img.bitmap.data[idx + 2];
      
      const rDist = 255 - red;
      const gDist = 255 - green;
      const bDist = 255 - blue;
      const dist = Math.sqrt(rDist*rDist + gDist*gDist + bDist*bDist);
      
      if (dist < 30) {
        img.bitmap.data[idx + 3] = 0;
      } else if (dist < 80) {
        const alpha = Math.floor(((dist - 30) / 50) * 255);
        img.bitmap.data[idx + 3] = alpha;
      }
    });
    
    await img.write(outputPath);
    console.log(`Successfully removed background for ${inputPath} -> ${outputPath}`);
  } catch (err) {
    console.error(`Error processing ${inputPath}:`, err);
  }
}

removeWhiteBg('public/assets/bhoomidwellersLogo.png', 'public/assets/bhoomidwellersLogo_trans.png');
