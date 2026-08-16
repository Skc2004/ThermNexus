export const fetchHistoricData = async (hours = 24, limit = 1000) => {
    try {
        const response = await fetch(`http://localhost:8889/history?hours=${hours}&limit=${limit}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const json = await response.json();
        if (json.status === 'ok') {
            return json.data;
        } else {
             throw new Error(json.message);
        }
    } catch (e) {
        console.error("Failed to fetch historic data: ", e);
        return [];
    }
};

export const fetchCapabilities = async () => {
    try {
        const response = await fetch(`http://localhost:8889/capabilities`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const json = await response.json();
        if (json.status === 'ok') {
            return json.data;
        } else {
             throw new Error(json.message);
        }
    } catch (e) {
        console.error("Failed to fetch capabilities: ", e);
        return { can_control_gpu: false, can_control_dvfs: false };
    }
};
