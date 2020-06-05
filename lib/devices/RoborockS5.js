const Roborock = require("./Roborock");
const MiioVacuum = require("./MiioVacuum");
const Tools = require("../Tools");
const NotImplementedError = require("./NotImplementedError");

class RoborockS5 extends Roborock {
    constructor(options) {
        super(options);

        /**
         * Distinguish between Gen3 and older firmware to adapt commands like addTimer.
         *
         * @private
         */
        this.isGen3 = false;
    }

    parseStatus(res) {
        this.isGen3 = res["msg_ver"] >= 3;
        super.parseStatus(res);
    }

    detectFanSpeeds(msg_ver) {
        /** @type {{[id: string]: {label: string, value: number}}} */
        let fanSpeeds = {};

        fanSpeeds[MiioVacuum.FAN_SPEEDS.MIN] = {label: "Min", value: 1};
        fanSpeeds[MiioVacuum.FAN_SPEEDS.LOW] = {label: "Silent", value: 38};
        fanSpeeds[MiioVacuum.FAN_SPEEDS.MEDIUM] = {label: "Normal", value: 60};
        fanSpeeds[MiioVacuum.FAN_SPEEDS.HIGH] = {label: "Turbo", value: 75};
        fanSpeeds[MiioVacuum.FAN_SPEEDS.MAX] = {label: "Max", value: 100};
        fanSpeeds[MiioVacuum.FAN_SPEEDS.MOP] = {label: "Mop", value: 105};

        if (msg_ver >= 3) {
            delete fanSpeeds[MiioVacuum.FAN_SPEEDS.MIN];
            fanSpeeds[MiioVacuum.FAN_SPEEDS.LOW].value = 101;
            fanSpeeds[MiioVacuum.FAN_SPEEDS.MEDIUM].value = 102;
            fanSpeeds[MiioVacuum.FAN_SPEEDS.HIGH].value = 103;
            fanSpeeds[MiioVacuum.FAN_SPEEDS.MAX].value = 104;
            fanSpeeds[MiioVacuum.FAN_SPEEDS.MOP].value = 105;
        }


        this.fanSpeeds = fanSpeeds;
    }

    /**
     * Set a new timer
     *
     * @param {string} cron
     */
    async addTimer(cron) {
        if (this.isGen3) {
            await this.sendCommand("set_timer", [[Date.now().toString(),
                [cron, ["start_clean", {"fan_power": 102, "segments": "", "repeat": 1, "clean_order_mode": 1}]]
            ]], {});
        } else {
            // older firmware don’t take arguments for set_timer
            await this.sendCommand("set_timer", [[Date.now().toString(), [cron, ["", ""]]]], {});
        }
    }

    /**
     * Sets the lab status aka persistent data feature of the S50
     *
     * @param {boolean} flag true for enabling lab mode and false for disabling
     */
    async setLabStatus(flag) {
        const labStatus = flag ? 1 : 0;
        await this.sendCommand("set_lab_status", [labStatus], {});
    }

    /**
     * Saves the persistent data like virtual walls and nogo zones
     * They have to be provided in the following format:
     *      https://github.com/marcelrv/XiaomiRobotVacuumProtocol/issues/15#issuecomment-447647905
     *      Software barrier takes a vector of [id, x1,y1,x2,y2]
     *      And no-go zone takes [id, x1,y1,x2,y2,x3,y3,x4,y4], which are the corners of the zone rectangle?
     *      Edit: see @JensBuchta's comment. The first parameter appears to be a type: 0 = zone, 1 = barrier
     *
     * @param {any} persistantData
     */
    async savePersistentData(persistantData) { //TODO: Store in valetudo config
        if (Array.isArray(persistantData)) {
            const flippedYCoordinates = persistantData.map(data => {
                if (data[0] === PERSISTENT_DATA_TYPES.ZONE) {
                    // this is a zone
                    return [
                        data[0],
                        data[1],
                        Tools.DIMENSION_MM - data[2],
                        data[3],
                        Tools.DIMENSION_MM - data[4],
                        data[5],
                        Tools.DIMENSION_MM - data[6],
                        data[7],
                        Tools.DIMENSION_MM - data[8]
                    ];
                } else {
                    return [
                        data[0],
                        data[1],
                        Tools.DIMENSION_MM - data[2],
                        data[3],
                        Tools.DIMENSION_MM - data[4],
                    ];
                }
            });

            if (flippedYCoordinates.reduce((total, currentElem) => {
                return total += currentElem[0] === PERSISTENT_DATA_TYPES.ZONE ? 4 : 2;
            }, 0) > 68) {
                throw new Error("too many forbidden markers to save!");
            }


            this.sendCommand("save_map", flippedYCoordinates, {timeout: 3500}).finally(() => {
                this.pollMap();
            });
        } else
            throw new Error("persistantData has to be an array.");
    }


    async getBackupMaps() {
        if (this.isGen3) {
            const response = await this.sendCommand("get_recover_maps", [], {});

            return response.map(e => {
                return {id: e[0], timestamp: new Date(e[1] * 1000)};
            });
        } else {
            throw new NotImplementedError();
        }
    }

    async restoreBackupMap(backupMap) {
        if (this.isGen3) {
            return this.sendCommand("recover_map", [backupMap.id]);
        } else {
            throw new NotImplementedError();
        }

    }
}

/** @enum {number} */
const PERSISTENT_DATA_TYPES = {
    "ZONE": 0,
    "BARRIER": 1
};

module.exports = RoborockS5;