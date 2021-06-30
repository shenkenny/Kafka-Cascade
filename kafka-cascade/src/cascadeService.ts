const EventEmitter = require('events');
import * as Types from './kafkaInterface';
import CascadeProducer from './cascadeProducer';
import CascadeConsumer from './cascadeConsumer';

// kafka object to create producer and consumer
// service callback
// dlq callback -> provide default
// success callback
// topic
// retry producer
// topic consumer
// retry levels -> provide default
// retry strategies per level

class CascadeService extends EventEmitter {
  kafka: Types.KafkaInterface;
  topic: string;
  serviceCB: Types.ServiceCallback;
  successCB: Types.RouteCallback;
  dlqCB: Types.RouteCallback;
  retries : number;
  topicsArr : string[];
  producer: CascadeProducer;
  consumer: CascadeConsumer;

  events = [ 
    'run',
    'stop',
    'pause',
    'resume',
    'receive',
    'success',
    'retry',
    'dlq',
    'error'
  ];

  constructor(kafka: Types.KafkaInterface, topic: string, groupId: string,
    serviceCB: Types.ServiceCallback, successCB: Types.RouteCallback, dlqCB: Types.RouteCallback) {
      super();
      this.kafka = kafka;
      this.topic = topic;
      this.serviceCB = serviceCB;
      this.successCB = successCB;
      this.dlqCB = dlqCB;
      this.retries = 0;
      this.topicsArr = [];

      // create producers and consumers
      this.producer = new CascadeProducer(kafka, dlqCB);
      this.consumer = new CascadeConsumer(kafka, topic, groupId, false); // revisit fromBeginning at a later point
  }

  connect():Promise<any> {
    return Promise.all([this.producer.connect(), this.consumer.connect()]);    
  }

  setRetryLevels(count: number) {
    if(this.topicsArr.length > count){
      const diff = this.topicsArr.length - count;
      for(let i = 0; i < diff; i++){
        this.topicsArr.pop();
      };
    }
    else {
      for(let i = this.retries; i < count; i++){
        this.topicsArr.push(this.topic + '-cascade-retry-' + (i+1));
      }
    }

    this.producer.setRetryTopics(this.topicsArr);
    this.retries = count;
  }

  run():Promise<any> {
    return new Promise(async (resolve, reject) => {
      try {
        const status = await this.consumer.run(this.serviceCB, this.successCB, (msg) => {
          try {
            this.producer.send(msg);
          }
          catch(error) {
            console.log('Caught error in reject callback: ' + error);
          }
        });
        this.emit('run');
        resolve(status);
      } catch(error) {
        this.emit('error', error);
        reject(error);
      }
      
    });
  }

  stop() {
    // consumer.stop();
    this.emit('stop');
  }

  pause() {
    // consumer.pause();
    this.emit('pause');
  }

  paused() {
    // return consume.paused();
  }

  resume() {
    // consume.resume();
    this.emit('resume');
  }

  on(event: string, callback: (arg: any) => any) {
    if(!this.events.includes(event)) throw new Error('Unknown event: ' + event);
    super.on(event, callback);
  }
}

export default CascadeService;