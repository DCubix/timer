// host from config.json

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

// Vue filter to format time
const fmtTime = (seconds) => {
    let hh = Math.floor(seconds / 3600);
    let mm = Math.floor((seconds % 3600) / 60);
    let ss = seconds % 60;

    // add leading zeros
    hh = hh < 10 ? `0${hh}` : hh;
    mm = mm < 10 ? `0${mm}` : mm;
    ss = ss < 10 ? `0${ss}` : ss;

    return `${hh}:${mm}:${ss}`;
};
Vue.filter('time', fmtTime);

let app = new Vue({
    el: '#app',
    data: () => {
        return {
            page: 'TIME',
            hh: 0,
            mm: 0,
            ss: 0,

            appState: {},

            ws: null,

            dialog: {
                ref: null,
                loading: false,
                title: '',

                id: null,

                lista: '',
                descricao: '',
                hh: 0,
                mm: 0,
                ss: 0
            },

            listas: {},

            listaSelecionada: '',
            tempoSelecionado: 0,

            automationListSecionada: '',
            automationWaitTime: 10,
        }
    },
    async mounted() {
        await configureApp();

        await this.getState();
        await this.getListas();

        // connect to websocket and listen for state changes
        this.ws = new WebSocket(`ws://${host}/ws`);
        this.ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'state') {
                this.appState = data.payload;
            } else if (data.type === 'data-update') {
                this.getListas();
            } else if (data.type === 'timer-end') {
                this.getState();
                this.getListas();
            } else if (data.type === 'timer-reset') {
                this.getState();
                this.getListas();
                this.listaSelecionada = '';
                this.tempoSelecionado = 0;
                this.automationListSecionada = '';
                this.automationWaitTime = 10;
                this.hh = 0;
                this.mm = 0;
                this.ss = 0;
                this.dialog.id = null;
                this.dialog.lista = '';
                this.dialog.descricao = '';
                this.dialog.hh = 0;
                this.dialog.mm = 0;
                this.dialog.ss = 0;
            }
        };

        // periodically check if ws is still connected
        setInterval(() => {
            if (this.ws.readyState !== WebSocket.OPEN) {
                this.ws = new WebSocket(`ws://${host}/ws`);
                console.log('Reconnecting to websocket...');
            }
        }, 1000);

        this.dialog.ref = this.$refs.addEditModal;
    },
    computed: {
        nomesListas() {
            return Object.keys(this.listas);
        },
        currentTimer() {
            return this.appState.currentTimer || { id: -1, seconds: 0 };
        },
        hostEncoded() {
            return encodeURIComponent(host);
        }
    },
    methods: {
        async startAutomacao() {
            const list = this.listas[this.automationListSecionada].map((t) => ({ id: t.id, seconds: t.timeSeconds }));
            const payload = {
                timers: list,
                waitBetweenTimers: this.automationWaitTime
            };
            await this.sendCommand('start-timer-queue', payload);
        },

        async stopAutomacao() {
            await this.sendCommand('stop-timer', 0);
        },

        async startTimer() {
            let seconds = this.hh * 3600 + this.mm * 60 + this.ss;
            await this.sendCommand('start-timer-single', { id: -1, seconds });
        },
        async pauseTimer() {
            await this.sendCommand('pause-timer');
        },
        async stopTimer() {
            await this.sendCommand('stop-timer');
        },
        async sendCommand(cmd, payload) {
            const res = await fetch(`${basePath}/command`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    command: cmd,
                    data: payload
                })
            });

            if (res.ok) {
                this.getState();
            }
        },
        async getState() {
            const res = await fetch(`${basePath}/state`);
            if (res.ok) {
                this.appState = await res.json();
                console.log(this.appState);
            }
        },
        async getListas() {
            const res = await fetch(`${basePath}/timers`);
            if (res.ok) {
                //group by listName
                const timers = await res.json();
                let listas = {};
                for (let timer of timers) {
                    if (!listas[timer.listName]) {
                        listas[timer.listName] = [];
                    }
                    listas[timer.listName].push(timer);
                }
                this.listas = listas;
            }
        },
        getLista(nome) {
            return this.listas[nome] || [];
        },
        getTempo(lista, id) {
            return this.getLista(lista).find((t) => t.id === id);
        },
        setTempo(seconds) {
            this.hh = Math.floor(seconds / 3600);
            this.mm = Math.floor((seconds % 3600) / 60);
            this.ss = seconds % 60;
        },
        async salvarTimer(lista, descricao, segundos) {
            const payload = {
                listName: lista,
                description: descricao,
                timeSeconds: segundos
            };
            const res = await fetch(`${basePath}/timers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                await this.getListas();
                await this.getState();
            }
        },
        async editarTimer(id, lista, descricao, segundos, dontRefetch) {
            const payload = {
                listName: lista,
                description: descricao,
                timeSeconds: segundos
            };
            const res = await fetch(`${basePath}/timers/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (res.ok && !dontRefetch) {
                await this.getListas();
                await this.getState();
            }
        },
        async deletarTimer(id) {
            const res = await fetch(`${basePath}/timers/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                await this.getListas();
                await this.getState();
            }
        },
        async moverTimerAcima(entry) {
            const res = await fetch(`${basePath}/timers/${entry.id}/move-up`, {
                method: 'PUT'
            });
            if (res.ok) {
                await this.getListas();
                await this.getState();
            }
        },
        async moverTimerAbaixo(entry) {
            const res = await fetch(`${basePath}/timers/${entry.id}/move-down`, {
                method: 'PUT'
            });
            if (res.ok) {
                await this.getListas();
                await this.getState();
            }
        },

        async panicAction() {
            await fetch(`${basePath}/panic`, {
                method: 'POST'
            });
        },

        dlgAdicionarShow() {
            this.dialog.title = 'Adicionar Novo Timer';
            this.dialog.id = null;
            this.dialog.lista = this.listaSelecionada;
            this.dialog.descricao = '';
            this.dialog.hh = 0;
            this.dialog.mm = 0;
            this.dialog.ss = 0;
            this.dialog.ref.showModal();
        },

        dlgEditarShow(entry) {
            this.dialog.title = 'Editar Timer';
            this.dialog.id = entry.id;
            this.dialog.lista = entry.listName;
            this.dialog.descricao = entry.description;
            this.dialog.hh = Math.floor(entry.timeSeconds / 3600);
            this.dialog.mm = Math.floor((entry.timeSeconds % 3600) / 60);
            this.dialog.ss = entry.timeSeconds % 60;
            this.dialog.ref.showModal();
        },

        async dlg_actionSalvarNovo() {
            this.dialog.loading = true;

            let segundos = this.dialog.hh * 3600 + this.dialog.mm * 60 + this.dialog.ss;
            await this.salvarTimer(this.dialog.lista, this.dialog.descricao, segundos);

            this.dialog.loading = false;
            this.dlgClose();
        },

        async dlg_actionSalvarEditar() {
            this.dialog.loading = true;

            let segundos = this.dialog.hh * 3600 + this.dialog.mm * 60 + this.dialog.ss;
            await this.editarTimer(this.dialog.id, this.dialog.lista, this.dialog.descricao, segundos);

            this.dialog.loading = false;
            this.dlgClose();
        },

        async actionDelete(id) {
            if (confirm('Deseja realmente excluir este timer?')) {
                await this.deletarTimer(id);
            }
        },

        dlgClose() {
            this.dialog.ref.close();
        }
    }
});
