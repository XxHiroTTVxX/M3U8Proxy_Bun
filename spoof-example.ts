import { AES } from './src/utils/AES';

// Example of how to update the spoofMediaSources function to work with the new encrypted format
function spoofMediaSourcesExample(
  sources: any,
  options: {
    baseUrl?: string;
    encrypt?: boolean;
    videoPath?: string;
    trackPath?: string;
    referer?: string;
  } = {}
) {
  const {
    baseUrl = "https://m3u8.proxy.com",
    encrypt = true,
    videoPath = '/video',
    trackPath = '',
    referer = 'https://megacloud.club/'
  } = options;

  function encodeUrl(url: string): string {
    if (!encrypt) return url;
    
    // Use the same secret key as in your .env file
    const secretKey = "crohvzxjqybvzdxlvygesvhvehgfawtm";
    
    // Create a data object containing both URL and referer
    const dataToEncrypt = JSON.stringify({
      url: url,
      referer: referer
    });
    
    return AES.Encrypt(dataToEncrypt, secretKey);
  }

  function processSource(source: any, path: string) {
    if (source.file) {
      source.file = `${baseUrl}${path}/${encodeUrl(source.file)}`;
    }
    return source;
  }

  // Process video sources
  for (const key of Object.keys(sources)) {
    if (Array.isArray(sources[key])) {
      (sources[key] as any[]).forEach(source => 
        processSource(source, videoPath)
      );
    } else if (sources[key]?.file) {
      processSource(sources[key] as any, videoPath);
    }
  }

  // Process track sources
  if (sources.track) {
    const trackSource = sources.track as any;
    if (Array.isArray(trackSource.tracks)) {
      trackSource.tracks.forEach((track: any) => 
        processSource(track, trackPath)
      );
    } else if (trackSource.file) {
      processSource(sources.track as any, trackPath);
    }
  }

  return sources;
}

// Example usage
const exampleSource = {
  hls: [
    {
      file: "https://lightningspark77.pro/_v7/71f87b4028d27b3ba749bd2029f3248245618a740ca81a9a9863f257784436f85c939482f4d306945639b935dc612f232173cae4f207297dea8798f69741cdadcf03986938ae645355b02ac49101bd99d26dbcacac3e6ab00b678324a21474728d09a70cb4b5086fbc36943efb9f1695c522b23382b639d8f473c8ce9a528151/master.m3u8"
    }
  ],
  track: {
    tracks: [
      {
        file: "https://example.com/subtitles/en.vtt",
        kind: "captions",
        label: "English"
      }
    ]
  }
};

// Example of how the API would use your function
const result = spoofMediaSourcesExample(exampleSource, {
  baseUrl: "http://localhost:3001",
  referer: "https://megacloud.club/"
});

console.log("Original source:");
console.log(JSON.stringify(exampleSource, null, 2));
console.log("\nProxied source:");
console.log(JSON.stringify(result, null, 2));
console.log("\nEach URL now contains both the original URL and referer encrypted in one parameter."); 