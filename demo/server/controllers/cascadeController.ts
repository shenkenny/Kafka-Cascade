 const { Kafka } = require('kafkajs');
const cascade = require('../../../kafka-cascade/index');
import * as Cascade from '../../../kafka-cascade/index';
import socket from '../websocket';

const kafka = new Kafka({
  clientId: 'kafka-demo',
  brokers: ['localhost:9092'],
});

const producer = kafka.producer();  

let topic = 'demo-topic';
const groupId = 'test-group';

const retryLevels = 5;
const levelCounts = (new Array(retryLevels+1)).fill(0);

// serviceCB simulates a realworld service by using the success value of the message to resolve or reject
const serviceCB:Cascade.Types.ServiceCallback = (msg, resolve, reject) => {
  const message = JSON.parse(msg.message.value);
  
  if(Math.random() < message.success) resolve(msg);
  else reject(msg);
};


const successCB:Cascade.Types.RouteCallback = (msg) => {
  const metadata = cascade.getMetadata(msg);
  levelCounts[metadata.retries]++;
};
const dlqCB:Cascade.Types.RouteCallback = (msg) => {
  levelCounts[levelCounts.length - 1]++;
};

var service: Cascade.CascadeService;

const startService = async (options?: {timeoutLimit?:number[], batchLimit?:number[]}) => {
  service = await cascade.service(kafka, topic, groupId, serviceCB, successCB, dlqCB);
  await service.setRetryLevels(retryLevels, options);
  
  await service.connect();
  await producer.connect();
  console.log('Connected to Kafka server...');
  await service.run();
  console.log('Listening to Kafka server...');
}

const stopService = async () => {
  await producer.disconnect();
  await service.disconnect();
  service = null;
}

// start express controller
const cascadeController:any = {};

cascadeController.startService = async (req: {query: {retries:string}}, res, next) => {
  try {
    startService();

    // what do we send back?
    res.locals.confirmation = 'Cascade service is connecting to Kafka server...';
    return next();
  }
  catch(error) {
    return next({
      log: 'Error in cascadeController.startService: ' + error,
      message: 'Error in cascadeController.startService, check the log',
    });
  }
};

cascadeController.sendMessage = async (req, res, next) => {
  try {
    let retries = req.query.retries;
    //TODO: add delayTime on to the argument
    res.locals = { retries: Number(retries), time: (new Date()).valueOf() };

    // check to see if server is running

    // send message
    await producer.send({
      topic,
      messages: [
        {
          value: JSON.stringify(res.locals),
        }
      ]
    });
    
    return next();
  }
  catch(error) {
    return next({
      log: 'Error in cascadeController.sendMessage: ' + error,
      message: 'Error in cascadeController.sendMessage, check the log',
    });
  }
};

cascadeController.stopService = async (req, res, next) => {
  try {
    stopService();
    // nothing else to do yet

    return next();
  }
  catch(error) {
    return next({
      log: 'Error in cascadeController.stopService: ' + error,
      message: 'Error in cascadeController.stopService, check the log',
    });
  }
};

// end express controller
export default cascadeController;


// start websocket functionality
var messageRate = 100;
var runningMessages = false;
const sendMessageContinuous = async () => {
  try {
    if(runningMessages && service) {
      await producer.send({
        topic,
        messages: [{
            value: JSON.stringify({success: 0.3}),
        }],
      });
    }
    // setTimeout(sendMessageContinuous, Math.round(1/messageRate * 1000));
    setTimeout(sendMessageContinuous, 100);
  }
  catch(error) {
    console.log('Error in sendMessageContinuous:', error);
  }
};

const bellCurvePropability = (max) => {
  const sech = (x:number) => 2 / (Math.exp(x) - Math.exp(-x));
  return Math.abs(((Math.random()*3-1.5)) * max);
}

const linearPropability = (max) => {
  return Math.random() * max;
}

socket.use('start', (req, res) => {
  console.log('Received start request');
  if(!service) {
    startService(req.options);
    runningMessages = true;
    sendMessageContinuous();
  }
});

socket.use('stop', (req, res) => {
  console.log('Received stop request');
  if(service) {
    stopService();
    runningMessages = false;
  }
});

socket.use('set_rate', (req, res) => {
  messageRate = req.rate;
});

const heartbeat = () => {
  if(service) {
    socket.send('heartbeat', {
      levelCounts,
    });

  }
  setTimeout(heartbeat, 100);
};
heartbeat();
