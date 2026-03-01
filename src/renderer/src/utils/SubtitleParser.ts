export interface ImportedPhrase {
    startTime: number;
    endTime: number;
    text: string;
}

export const SubtitleParser = {
    parseSRT: (content: string): ImportedPhrase[] => {
        const phrases: ImportedPhrase[] = [];
        const blocks = content.trim().split(/\n\s*\n/);

        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length >= 3) {
                const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
                if (timeMatch) {
                    const startTime = SubtitleParser.timecodeToSeconds(timeMatch[1]);
                    const endTime = SubtitleParser.timecodeToSeconds(timeMatch[2]);
                    const text = lines.slice(2).join(' ').replace(/<[^>]*>/g, '').trim();
                    phrases.push({ startTime, endTime, text });
                }
            }
        }
        return phrases;
    },

    parseXML: (content: string): ImportedPhrase[] => {
        const phrases: ImportedPhrase[] = [];
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "text/xml");

        // Simple parsing for FCPXML or generic subtitle XML
        // This is a basic implementation and might need adjustment based on the specific XML flavor
        const clips = xmlDoc.getElementsByTagName('title') || xmlDoc.getElementsByTagName('clip');

        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            const startStr = clip.getAttribute('start') || clip.getAttribute('offset');
            const durationStr = clip.getAttribute('duration');
            const textNode = clip.getElementsByTagName('text')[0];
            const text = textNode ? textNode.textContent || "" : "";

            if (startStr && durationStr) {
                // Simplified time parsing (assumes seconds or frame-based values)
                const startTime = parseFloat(startStr) || 0;
                const duration = parseFloat(durationStr) || 2;
                phrases.push({ startTime, endTime: startTime + duration, text });
            }
        }
        return phrases;
    },

    timecodeToSeconds: (tc: string): number => {
        const [hms, ms] = tc.replace(',', '.').split('.');
        const [h, m, s] = hms.split(':').map(parseFloat);
        return h * 3600 + m * 60 + s + (ms ? parseFloat(`0.${ms}`) : 0);
    }
};
