var request = require("request");
var fs = require('fs');
var fse = require('fs-extra');
var Bot = require('node-telegram-bot');
var path = require('path');
var sleep = require('sleep');
//var redis = require("redis");

const imagePath = 'http://www.aecosan.msssi.gob.es/AECOSAN/docs/img/consumo/img_redalerta/';
const docPath = 'http://www.aecosan.msssi.gob.es/AECOSAN/docs/documentos/consumo/pdf_redalerta/';
const alertasPath = 'http://www.aecosan.msssi.gob.es/AECOSAN/resources/js/consumo/datos_notificaciones.js';
const lastAlertPostedFile = 'lastAlert.txt';
const botToken = '162669753:AAFRfLTvifLDuyi0BxSs0XTylhUlXPYjn2M'; //secret token!!! don't share it!!
const channelName = '@alertasConsumo'; // public access URL: telegram.me/alertasconsumo
//const channelName = '@canalDeTest'; // public access URL: telegram.me/canalDeTest
const mediaPath = 'images';

function writeLastAlertPosted(noticiaIDToPersist) {
 /**   console.log('writing into redis: ' + noticiaIDToPersist);
    redisClient.set('lastAlert',noticiaIDToPersist , function(rerror, resonse) {
        console.log(resonse);
        redisClient.quit();
    });**/ 
    fs.writeFileSync(lastAlertPostedFile, noticiaIDToPersist, 'utf8');
}

//class Alerta
function Alerta(a, b, c, d, e, f, g, h, i) {
    this.localId = a;
    this.year = b;
    this.globalId = c;
    this.date = d;
    this.descripcion = e;
    this.onlineDocument = f;
    this.image = g;
    this.category = h;
    this.organismo = i;
    this.sended = false;
}

Alerta.prototype = {
    constructor: Alerta,

    ToString: function() {
        var fullAlertString;
        fullAlertString = "Numero Alerta: INC-" + this.globalId + "\r\n";
        fullAlertString = fullAlertString + "Identificación del producto: " + this.descripcion + "\r\n";
        fullAlertString = fullAlertString + "Categoria: " + this.category + "\r\n";
        fullAlertString = fullAlertString + "Órgano notificante: " + this.organismo + "\r\n";
        fullAlertString = fullAlertString + "Fecha: " + this.date + "\r\n";
        fullAlertString = fullAlertString + "[Mas detalles](" + docPath + this.onlineDocument + ")";
        return fullAlertString;
    }
};

//end class Alerta

//class ListaAlertas
function ListaAlertas() {
    this.lastAlertPosted='';
    this.arrayAlerts = [];
    this.numNotis = 0;
    this.skipAlerta = false;
}

ListaAlertas.prototype = {
    constructor: ListaAlertas,

    Fill: function(jsString, lastAlert) {
        var fillFunction = new Function('listadoNotis', jsString);//SECURITY WARNING, do not use in production
        fillFunction(this);
        this.numNotis = this.arrayAlerts.length;
    },

    addNotificacion: function(a, b, c, d, e, f, g, h, i) { //called by "jsString" code
        var newAlert = new Alerta(a, b, c, d, e, f, g, h, i);
        if (this.skipAlerta) { //this sucks, I know, parse and cut "jsString" before execute it in next version
            return;
        }
        if (newAlert.globalId == this.lastAlertPosted) {
            this.skipAlerta = true;
            return;
        }
        this.arrayAlerts.unshift(newAlert); //Alerts comes newest first, lets inverse that

    },

    GetAlerta: function(index) {
        return this.arrayAlerts[index];
    },

    IsEmpty: function() {
        return this.arrayAlerts.length <= 0;
    }
};
//end class ListaAlertas

//class AlertasService
function AlertasService() {
    this.bot = new Bot({
        token: botToken
    });
    this.listadoAlertas = new ListaAlertas();
    this.mainFlow = this.PublishAlerts();
}


AlertasService.prototype = {
    constructor: AlertasService,

    Run: function() {
        this.mainFlow.next(); //start main flow generator
    },

    //main flow
    PublishAlerts: function*() {
        var jsString = yield this.GetAlertasJSString(); //download JSString
        var lastAlertID = this.readLastAlertPosted(); // read persistence last alert
        this.listadoAlertas.lastAlertPosted = lastAlertID;
        this.listadoAlertas.Fill(jsString, lastAlertID); //fill data structure
        if (this.listadoAlertas.IsEmpty()) { //no new alerts
            console.log('No hay nuevas noticias que procesar');
            return;
        }
        yield this.GetImagenesAlertas(); //download Alert images
        yield this.SendAlertasToTelegramBot(); //send images and text to telegram
        this.RemoveMedia(); //remove image files async
        this.PersistLastAlertSended(); //write persistence last alert
    },

    readLastAlertPosted: function() {
      /**    var mainFlow = this.mainFlow;
        redisClient.get('lastAlert', onReaded);

        function onReaded(error, result) {
            console.log('reading from redis: ' + result);
            mainFlow.next(result);
        }**/
        
       return fs.readFileSync(lastAlertPostedFile, 'utf8');

    },

    GetAlertasJSString: function() {
        var mainFlow = this.mainFlow;

        var onFinish = function GetAlertasJSStringCallback(error, response, body) {
            if (error != null) {
                console.log(error);
                return;
            }
            mainFlow.next(body); //jsString downloaded, continue main flow 
        };

        var options = {
            encoding: 'utf16le'
        };
        request(alertasPath, options, onFinish);
    },

    GetImagenesAlertas: function() {
        var retrievedImages = 0;
        var imagesToRetrieve = this.listadoAlertas.numNotis;
        var mainFlow = this.mainFlow;

        var onFinishWriteDisk = function WriteToDiskCallBakc() {
            retrievedImages++; //one more image writed into disk
            if (retrievedImages >= imagesToRetrieve) {
                mainFlow.next(); //all images writed in disk, continue main flow
            }
        };

        var onFinishRequest = function DownloadImagenesAlertasCallback(error, response, body) {
            if (error != null) {
                console.log(error);
            }
        };

        for (var index = 0; index < this.listadoAlertas.numNotis; index++) {
            var noticia = this.listadoAlertas.GetAlerta(index);
            var fsStream = fs.createWriteStream(path.join(mediaPath, noticia.image));
            fsStream.on('finish', onFinishWriteDisk); //eventEmiter because I can not found how use callback in fsStream with pipes
            request(imagePath + noticia.image, onFinishRequest).pipe(fsStream); //downlad images async
        }
    },

    //Send Alert means send Alert image firs then send Alert text in order,  
    //also need send every alert pair (img and txt) in order 
    //so async here is a pain in the ass
    SendAlertasToTelegramBot: function() {

        var mainFlow = this.mainFlow;

        //define generator with the main loop
        var loopIterator = function*(listadoAlertas, sendAlertFnc, bot) {
            for (var index = 0; index < listadoAlertas.numNotis; index++) {
                var alerta = listadoAlertas.GetAlerta(index);
                yield sendAlertFnc(alerta, bot, loopIterator); //send Img and txt 
                sleep.sleep(2); //telegram error << too many request, try later >>
            }
            mainFlow.next(); //all alerts sended, continue main flow
        }(this.listadoAlertas, this.SendAlertaToTelegramBot, this.bot);

        loopIterator.next(); //start loop
    },

    //just chanin the two functions using callbacks
    SendAlertaToTelegramBot: function(alerta, bot, loopIterator) {

        function SendText() {

            var options = {
                chat_id: channelName,
                text: alerta.ToString(),
                parse_mode: "Markdown"
            };
            bot.sendMessage(options, function onSended(err, msg) {
                if (err) {
                    console.log(err);
                }
                else {
                    alerta.sended = true;
                } //sended if at least text was sended
                loopIterator.next(); // Send next alert anyway
            });
        }


        var options = {
            chat_id: channelName,
            caption: 'Imagen del producto alertado',
            files: {
                photo: path.join(mediaPath, alerta.image)
            }
        };
        //send image
        console.log('Enviando alerta' + alerta.globalId);
        bot.sendPhoto(options, function onSended(err) {
            if (err) {
                console.log(err);
            }
            SendText(); //send text anyway
        });

    },

    RemoveMedia: function() {
        fse.emptyDir(mediaPath, function(err) {
            if (err) console.log(err);
        });
    },

    PersistLastAlertSended: function() {
        for (var i = this.listadoAlertas.numNotis - 1; i >= 0; i--) {
            if (this.listadoAlertas.GetAlerta(i).sended) {
                writeLastAlertPosted(this.listadoAlertas.GetAlerta(i).globalId);
                break;
            }
        }
    }
};
//end class AlertasService

function launchService() {
    console.log("Launching the service");
 //   redisClient = redis.createClient();
    var as = new AlertasService();
    as.Run();
}


//launchService();
var CronJob = require('cron').CronJob;
new CronJob({
  cronTime: '*/50 * * * *', 
  onTick: launchService,
  start: true
});
