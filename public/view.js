let host = '192.168.100.3:5454';
let basePath = `http://${host}/api`;

async function configureApp() {
    const res = await fetch('config.json');
    if (res.ok) {
        const config = await res.json();
        host = config.host + ':' + config.port;
        basePath = `http://${host}/api`;
    }
}

let app = new Vue({
    el: '#app',
    data: () => {
        return {
            state: 'IDLE', // IDLE, RUNNING, TIMER_ENDED, PAUSED, WAITING
            appState: {},

            ws: null
        };
    },
    async mounted() {
        await configureApp();
        
        // connect to websocket and listen for state changes
        // if the host is passed as a query parameter (h) use that, otherwise use the default
        this.ws = new WebSocket(`ws://${host}/ws`);
        this.ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'state') {
                this.appState = data.payload;
            } else if (data.type === 'timer-wait') {
                this.state = 'WAITING';
            } else if (data.type === 'timer-start') {
                this.state = 'RUNNING';
            } else if (data.type === 'timer-end') {
                this.state = 'TIMER_ENDED';
            } else if (data.type === 'timer-pause') {
                this.state = 'PAUSED';
            } else if (data.type === 'timer-resume') {
                this.state = 'RUNNING';
            } else if (data.type === 'timer-reset') {
                this.state = 'IDLE';
            }
        };

        // periodically check if ws is still connected
        setInterval(() => {
            if (this.ws.readyState !== WebSocket.OPEN) {
                this.ws = new WebSocket(`ws://${host}/ws`);
                console.log('Reconnecting to websocket...');
            }
        }, 1000);
    },
    computed: {
        stateColor() {
            if (this.state === 'IDLE') {
                return 'black';
            } else if (this.state === 'RUNNING') {
                return '#00a023';
            } else if (this.state === 'TIMER_ENDED') {
                return '#c70000';
            } else if (this.state === 'PAUSED') {
                return '#de7300';
            } else if (this.state === 'WAITING') {
                return '#004cf0';
            }
            return 'black';
        },
        timer() {
            return this.appState.timerValue;
        },
        isHours() {
            return this.timer >= 60;
        },
        timerValueHoursMinutes() {
            if (this.timer >= 60) {
                let hours = Math.floor(this.timer / 60);
                hours = hours < 10 ? `0${hours}` : hours;
                return `${hours}`;
            } else {
                let minutes = Math.floor(this.timer / 60);
                minutes = minutes < 10 ? `0${minutes}` : minutes;
                return `${minutes}`;
            }
        },
        timerValueSecondsMinutes() {
            if (this.timer >= 60) {
                let minutes = this.timer % 60;
                minutes = minutes < 10 ? `0${minutes}` : minutes;
                return `${minutes}`;
            } else {
                let seconds = this.timer % 60;
                seconds = seconds < 10 ? `0${seconds}` : seconds;
                return `${seconds}`;
            }
        },
        timerText() {
            // if timer is greater than or equal to 60 seconds, display in hh::mm format
            if (this.timer >= 60) {
                let hours = Math.floor(this.timer / 60);
                let minutes = this.timer % 60;
                hours = hours < 10 ? `0${hours}` : hours;
                minutes = minutes < 10 ? `0${minutes}` : minutes;
                return `${hours}:${minutes}`;
            } else {
                let minutes = Math.floor(this.timer / 60);
                let seconds = this.timer % 60;
                minutes = minutes < 10 ? `0${minutes}` : minutes;
                seconds = seconds < 10 ? `0${seconds}` : seconds;
                return `${minutes}:${seconds}`;
            }
        }
    },
});
