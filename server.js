const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const { TimerEntry } = require('./database.js');
const app = express();
const wss = new WebSocket.Server({
    noServer: true,
    path: '/ws'
});

function wsSend(type, payload) {
    wss.clients.forEach((client) => {
        const message = JSON.stringify({ type, payload });
        client.send(message);
    });
}

let timerInterval = null;
const appState = {
    timerState: 'STOPPED',
    timerValue: 0,
    timerQueue: [],
    currentTimer: { id: -1, seconds: 0 },
    timerMode: 'SINGLE', // SINGLE, QUEUE
    waitBetweenTimers: 10,

    startTimer(mode, timers, waitBetweenTimers) {
        if (appState.timerState === 'RUNNING') {
            return;
        }

        appState.timerState = 'RUNNING';
        appState.timerMode = mode;
        appState.timerQueue = timers;
        appState.waitBetweenTimers = waitBetweenTimers;

        appState.runNextTimer();

        timerInterval = setInterval(() => {
            switch (appState.timerState) {
                case 'STOPPED':
                    clearInterval(timerInterval);
                    return;
                case 'WAITING':
                case 'PAUSED':
                    return;
                case 'RUNNING':
                    if (appState.timerValue <= 0) {
                        appState.timerValue = 0;

                        if (appState.timerMode === 'QUEUE') {
                            if (appState.timerQueue.length === 0) {
                                appState.timerState = 'STOPPED';
                                appState.currentTimer = { id: -1, seconds: 0 };
                                wsSend('state', appState);
                                wsSend('timer-end', 0);
                                return;
                            }

                            appState.timerState = 'WAITING';
                            wsSend('timer-wait', 0);
                            setTimeout(() => appState.runNextTimer(), appState.waitBetweenTimers * 1000);
                        } else {
                            appState.timerState = 'STOPPED';
                            wsSend('timer-end', 0);
                        }
                    } else {
                        appState.timerValue--;
                        wsSend('state', appState);
                    }
                    break;
            }
        }, 1000);

        wsSend('state', appState);
    },

    startTimerQueue(timers, waitBetweenTimers) {
        appState.startTimer('QUEUE', timers, waitBetweenTimers);
    },

    startTimerSingle(id, seconds) {
        appState.startTimer('SINGLE', [{ id, seconds }], 0);
    },

    resumeTimer() {
        if (appState.timerState === 'RUNNING') {
            return;
        }

        appState.timerState = 'RUNNING';
        wsSend('state', appState);
        wsSend('timer-resume', 0);
    },

    pauseTimer() {
        if (appState.timerState === 'PAUSED') {
            return;
        }

        appState.timerState = 'PAUSED';

        wsSend('state', appState);
        wsSend('timer-pause', 0);
    },

    stopTimer() {
        if (appState.timerState === 'STOPPED') {
            return;
        }

        appState.timerState = 'STOPPED';
        appState.timerValue = 0;
        appState.timerQueue = [];

        wsSend('state', appState);
    },

    runNextTimer() {
        if (appState.timerQueue.length === 0) {
            appState.timerState = 'STOPPED';
            wsSend('state', appState);
            return;
        }

        let { id, seconds } = appState.timerQueue.shift();

        console.log(`Running timer ${id} with ${seconds} seconds`);

        appState.currentTimer = { id, seconds };
        appState.timerState = 'RUNNING';
        appState.timerValue = seconds;

        wsSend('state', appState);
        wsSend('timer-start', 0);
    }
};

wss.on('connection', (ws) => {
    wsSend('state', appState);
    console.log('Client connected.');
});

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));
app.use(bodyParser.json());
app.use(cors());

// API
app.post('/api/command', (req, res) => {
    if (!req.body) {
        return res.status(400).send('Request body is missing');
    }

    // validate body
    if (!req.body.command) {
        return res.status(400).send('Command is missing');
    }
    
    const command = req.body.command;
    const data = req.body.data;

    switch (command) {
        case 'start-timer-single': {
            if (appState.timerState === 'RUNNING') {
                return res.status(400).send('Timer is already running');
            }

            if (appState.timerState === 'PAUSED') {
                appState.resumeTimer();
            } else {
                appState.startTimerSingle(data.id, data.seconds);
            }
        } break;
        case 'start-timer-queue': {
            if (appState.timerState === 'RUNNING') {
                return res.status(400).send('Timer is already running');
            }

            if (appState.timerState === 'PAUSED') {
                appState.resumeTimer();
            } else {
                appState.startTimerQueue(data.timers, data.waitBetweenTimers);
            }
        } break;
        case 'pause-timer': {
            if (appState.timerState === 'PAUSED') {
                return res.status(400).send('Timer is already paused');
            }

            appState.pauseTimer();
        } break;
        case 'stop-timer': {
            if (appState.timerState === 'STOPPED') {
                return res.status(400).send('Timer is already stopped');
            }

            appState.stopTimer();
        } break;
    }
});

app.get('/api/state', (req, res) => {
    res.json(appState);
});

app.get('/api/timers/fetch/:list', async (req, res) => {
    const listName = req.params.list;
    const timers = await TimerEntry.findAll({
        where: {
            listName: listName
        },
        order: [
            ['order', 'ASC']
        ]
    });
    res.json(timers.map((t) => t.toJSON()));
});

app.post('/api/timers', async (req, res) => {
    const timerEntry = req.body;
    try {
        // get max order from list
        const maxOrder = await TimerEntry.max('order', {
            where: {
                listName: timerEntry.listName
            }
        });
        timerEntry.order = maxOrder === null ? 0 : maxOrder + 1;
        const newTimerEntry = await TimerEntry.create(timerEntry);

        wsSend('data-update', 0);
        
        res.json(newTimerEntry.toJSON());
    } catch (error) {
        res.status(500).send(error);
    }
});

app.get('/api/timers', async (req, res) => {
    const timers = await TimerEntry.findAll({
        order: [
            ['order', 'ASC']
        ]
    });
    res.json(timers.map((t) => t.toJSON()));
});

app.put('/api/timers/:id', async (req, res) => {
    const id = req.params.id;
    const timerEntry = req.body;
    try {
        const timer = await TimerEntry.findByPk(id);
        if (!timer) {
            return res.status(404).send('Timer not found');
        }
        await timer.update(timerEntry);

        wsSend('data-update', 0);

        res.json(timer.toJSON());
    } catch (error) {
        res.status(500).send(error);
    }
});

app.put('/api/timers/:id/move-up', async (req, res) => {
    const id = req.params.id;
    try {
        const timer = await TimerEntry.findByPk(id);
        if (!timer) {
            return res.status(404).send('Timer not found');
        }

        const allTimers = await TimerEntry.findAll({
            where: {
                listName: timer.listName
            },
            order: [
                ['order', 'ASC']
            ]
        });

        const index = allTimers.findIndex((t) => t.id === timer.id);
        if (index > 0) {
            const timerAnterior = allTimers[index - 1];
            if (timer.order === timerAnterior.order) {
                timer.order--;
            } else {
                const order = timer.order;
                timer.order = timerAnterior.order;
                timerAnterior.order = order;
            }
            await timer.save();
            await timerAnterior.save();
        }

        wsSend('data-update', 0);

        res.status(200).send();
    } catch (error) {
        res.status(500).send(error);
    }
});

app.put('/api/timers/:id/move-down', async (req, res) => {
    const id = req.params.id;
    try {
        const timer = await TimerEntry.findByPk(id);
        if (!timer) {
            return res.status(404).send('Timer not found');
        }

        const allTimers = await TimerEntry.findAll({
            where: {
                listName: timer.listName
            },
            order: [
                ['order', 'ASC']
            ]
        });

        const index = allTimers.findIndex((t) => t.id === timer.id);
        if (index < allTimers.length - 1) {
            const timerPosterior = allTimers[index + 1];
            if (timer.order === timerPosterior.order) {
                timer.order++;
            } else {
                const order = timer.order;
                timer.order = timerPosterior.order;
                timerPosterior.order = order;
            }
            await timer.save();
            await timerPosterior.save();
        }

        wsSend('data-update', 0);

        res.status(200).send();
    } catch (error) {
        res.status(500).send(error);
    }
});

app.delete('/api/timers/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const timer = await TimerEntry.findByPk(id);
        if (!timer) {
            return res.status(404).send('Timer not found');
        }
        await timer.destroy();

        wsSend('data-update', 0);
        
        res.status(200).send();
    } catch (error) {
        res.status(500).send(error);
    }
});

app.get('/api/timers/lists', async (req, res) => {
    const lists = await TimerEntry.findAll({
        attributes: ['listName'],
        group: ['listName']
    });
    res.json(lists.map((l) => l.listName));
});

app.post('/api/panic', async (req, res) => {
    appState.stopTimer();
    appState.timerQueue = [];
    appState.timerValue = 0;
    appState.timerState = 'STOPPED';
    appState.timerMode = 'SINGLE';
    appState.currentTimer = { id: -1, seconds: 0 };
    appState.waitBetweenTimers = 10;

    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    wsSend('state', appState);
    wsSend('timer-reset', 0);
    res.status(200).send();
});
//

// read port from public/config.json
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(`${publicPath}/config.json`));
const port = config.port || 5454;
const server = app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
        wsSend('state', appState);
    });
});
