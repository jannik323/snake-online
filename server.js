const WebSocketServer = require("ws")

let sockets = [];
const PORT = 44444;
let idCounter = 0;
let apples = [];
let obstacles = [];
let snakes = [];
let safezones = [];

let grid = [];

const safezonePerRow=2;
const safezoneScale=2;
const gameSpeed=350;
const gridsize=50;
const obstaclecount=5;
const obstaclegrow=4;
const applecount=25;
const maxapplecount=applecount*3;

class MessageHandler{
    constructor(){
        
    }
    handle(socket,message){
        try {
            let jsonMsg = JSON.parse(message);
            this[jsonMsg.t](socket,jsonMsg.data);
        } catch (error) {
            console.error("message is not json:"+ error.name);
        }
    }
    addMsgHandle(type,handle){
        this[type]=handle;
    }
}

class SafeZone{
    x;y;
    size;
    constructor(x,y,size=10){
        this.x=Math.round(x);
        this.y=Math.round(y);
        this.size=Math.round(size);
    }
    checkCollision(x,y){
        if(x>=this.x&&y>this.y&&x<this.x+this.size&&y<this.y+this.size)return true;
        return false;
    }
    getSpawnPos(){
        return {x:this.x+Math.floor(Math.random()*this.size),y:this.y+Math.floor(Math.random()*this.size)}
    }
}

class GridObject{
    gridtype;
    x;y;
    constructor(){
        this.x=-1;
        this.y=-1;
    }
    setGridPos(){
        if(this.x<0||this.y<0||this.x>=gridsize||this.y>=gridsize)return;
        grid[this.x][this.y]=this;
    }
    resetGridPos(){
        if(this.x<0||this.y<0||this.x>=gridsize||this.y>=gridsize)return;
        grid[this.x][this.y]=null;
    }
}

class Obstacle extends GridObject{
    id;
    constructor(id,x=null,y=null){
        super();
        this.id=id;
        if(x==null||y==null){
            this.randomPos();
        }else{
            this.x=x;
            this.y=y;
            this.setGridPos();
        }
        this.gridtype="Obstacle";
    }
    anyCollision(x,y){
        if(this.x==x&&this.y==y)return true;
        return false;
    }
    randomPos(){
        do{
            this.x = Math.floor(Math.random()*gridsize);
            this.y = Math.floor(Math.random()*gridsize);
        }while(collisionCheck(this.x,this.y)!=null);
        this.setGridPos();
    }
    randomPosAround(){ 
        let tries=0;
        let res = {x:0,y:0};
        do{
            if(tries>6){ 
                return null;
            };
            switch(Math.floor(Math.random()*4)){
                case 0:
                    res.x=this.x-1;
                    res.y=this.y;
                    break;
                case 1:
                    res.x=this.x-1;
                    res.y=this.y;
                    break;
                case 2:
                    res.x=this.x;
                    res.y=this.y+1;
                    break;
                case 3:
                    res.x=this.x;
                    res.y=this.y-1;
                    break;
            }
            tries++;
        }while(collisionCheck(res.x,res.y)!=null);
        return res;
    }
    grow(growam){
        growam--;
        if(growam<=0)return;
        for (let i = 0; i < growam; i++) {
            let res = this.randomPosAround();
            if(res==null)return;
            let obstacle = new Obstacle(obstacles.length,res.x,res.y);
            obstacles.push(obstacle);
            obstacle.grow(growam);
        }
    }
}

class Apple extends GridObject{
    id;
    constructor(id,x=null,y=null){
        super();
        this.id=id;
        if(x==null||y==null){
            this.randomPos();
        }else{
            this.x=x;
            this.y=y;
            this.setGridPos();
        }
        this.gridtype="Apple";
    }
    anyCollision(x,y){
        if(this.x==x&&this.y==y)return true;
        return false;
    }
    randomPos(){
        let oldx= this.x;
        let oldy= this.y;
        do{
            this.x = Math.floor(Math.random()*gridsize);
            this.y = Math.floor(Math.random()*gridsize);
        }while(collisionCheck(this.x,this.y)!=null||(this.x==oldx&&this.y==oldy));
        this.setGridPos();
    }
}

class Snake {
    head;
    dir;
    username;
    state="a";
    eaten = 0;
    length = 0;
    constructor(x,y){
        this.head=new Body(x,y,this,true);
        this.dir = {x:1,y:0};
        this.state="a";
    }
    
    reset(x,y){
        this.head=new Body(x,y,this,true);
        this.dir = {x:1,y:0};
        this.state="a";
        this.eaten = 0;
        this.length = 0;
    }
    headCollision(x,y){
        if(this.state=="d")return false;
        if(this.head.x==x&&this.head.y==y)return true;
        return false;
    }
    bodyCollision(x,y){
        if(this.state=="d")return false;
        if(this.head.nextBody==null)return false;
        return this.head.nextBody.bodyCollision(x,y);
    }
    anyCollision(x,y){
        if(this.state=="d")return false;
        return this.head.bodyCollision(x,y);
    }
    die(){
        let droppedApples = [];
        this.state="d";
        this.head.die();
        if(this.head.nextBody!=null&&this.head.nextBody.dropApples(droppedApples)){
            sendMessageToAll("appleadd",droppedApples);
        }
    }
    move(){
        if(this.head.nextBody==null){
            this.head.resetGridPos();
        }
        this.head.x+=this.dir.x;
        this.head.y+=this.dir.y;
        if(this.head.x>gridsize-1||this.head.x<0||this.head.y>gridsize-1||this.head.y<0){
            sendMessageToSnake(this,"death",{cause:"you didn't see the border"});
            this.die();
            return;
        }
        this.head.setGridPos();
    }
    getTail(){
        if(this.head.nextBody==null)return this.head;
        return this.head.nextBody.getTail();
    }
    update(){
        if(this.state=="d")return;

        let toCollideWith = collisionCheck(this.head.x+this.dir.x,this.head.y+this.dir.y);

        switch(toCollideWith){
            case "Obstacle":
                sendMessageToSnake(this,"death",{cause:"you ran into a rock"});
                this.die();
                return;
            case "Apple":
                let a = grid[this.head.x+this.dir.x][this.head.y+this.dir.y];
                a.resetGridPos();
                a.randomPos();
                sendMessageToAll("applechange", {id:a.id,x:a.x,y:a.y});
                this.eaten++;
                break;
            case "Body":
                let body = grid[this.head.x+this.dir.x][this.head.y+this.dir.y];
                let snake = body.snakeRef;
                if(snake.state=="d")break;
                if(body.previousBody==null){
                    sendMessageToSnake(this,"death",{cause:"head to head collision with "+snake.username});
                    this.die();

                    sendMessageToSnake(snake,"death",{cause:"head to head collision with "+this.username});
                    snake.die();
                }else{
                    if(snake==this){
                        sendMessageToSnake(this,"death",{cause:"you collided with yourself"});
                    }else{
                        sendMessageToSnake(this,"death",{cause:"snake"+snake.username+" caused your demise"});
                    }
                    this.die();
                }
                return;
        }

        if(this.eaten>this.length){
            this.length++;
            this.getTail().addBody();
        }

        this.getTail().move();
        this.move();
    }
}

class Body extends GridObject{
    previousBody;
    nextBody;
    snakeRef;
    constructor(x,y,previousBody=null,head=false){
        super();
        this.x=x;
        this.y=y;
        if(!head){
            this.previousBody=previousBody;
            this.snakeRef=this.previousBody.snakeRef;
        }else{
            this.snakeRef=previousBody;
        }
        this.gridtype="Body";
        this.setGridPos();
    }
    bodyCollision(x,y){
        if(this.x==x&&this.y==y)return true;
        if(this.nextBody==null)return false;
        return this.nextBody.bodyCollision(x,y);
    }
    addBody(){
        if(this.nextBody!=null)return;
        this.nextBody=new Body(this.x,this.y,this);
    }
    getTail(){
        if(this.nextBody==null)return this;
        return this.nextBody.getTail();
    }
    move(){
        if(this.previousBody==null)return; //the order of these is important 
        if(this.nextBody==null){
            this.resetGridPos();
        }
        this.x=this.previousBody.x;
        this.y=this.previousBody.y;
        this.setGridPos();
        this.previousBody.move();
    }
    die(){
        this.resetGridPos();
        if(this.nextBody!=null){
            this.nextBody.die();
        }
    }
    dropApples(collection){

        if(apples.length<maxapplecount && Math.random()>0.5){
            let apple = new Apple(apples.length,this.x,this.y);
            apples.push(apple);
            collection.push(apple);
            if(this.nextBody!=null){
                this.nextBody.dropApples(collection);
            }
            return true;
        }

        if(this.nextBody!=null){
            return this.nextBody.dropApples(collection);
        }

        return false;
    }
}

function sendMessage(socket,type,object,replacer=defaultReplacer){
    socket.send(JSON.stringify({t:type,data:object},replacer));
}
function sendMessageToAll(type,object,replacer=defaultReplacer){
    sockets.forEach(s=>{
        s.send(JSON.stringify({t:type,data:object},replacer));
    })
}

function sendMessageToAllExcept(socket,type,object,replacer=defaultReplacer){
    sockets.forEach(s=>{
        if(s==socket)return;
        s.send(JSON.stringify({t:type,data:object},replacer));
    })
}

function sendMessageToSnake(snake,type,object,replacer=defaultReplacer){
    let s = getSocketFromSnake(snake);
    if(s==null){
        console.error("socket not found for snake: "+snake);
        return;
    }
    s.send(JSON.stringify({t:type,data:object},replacer));
}

function getSocketFromSnake(snake){
    return sockets.find(s=>s.snake==snake);
}

function defaultReplacer(key,value){
    if (key=="previousBody") return undefined;
    else if (key=="snakeRef") return undefined;
    else if (value!=null&&value.state=="d") return undefined;
    else if (key=="gridtype") return undefined;
    return value;
}

function updateReplacer(key,value){
    if (key=="head") return undefined;
    else if (key=="gridtype") return undefined;
    else if (key=="snakeRef") return undefined;
    else if (key=="length") return undefined;
    else if (key=="username") return undefined;
    return value;
}

let msgHandler = new MessageHandler();

msgHandler.addMsgHandle("restart",(socket,data)=>{
    let randomSpawn = getRandomSpawn();
    socket.snake.reset(randomSpawn.x,randomSpawn.y);
    sendMessageToAll("snakespawn",socket.snake);
});

msgHandler.addMsgHandle("msg",(socket,data)=>{
    sockets.forEach(s=>{
        sendMessage(s,"msg",socket.username+": "+data);
    })
});

msgHandler.addMsgHandle("username",(socket,data)=>{
    console.log(socket.username+" is now "+ data);
    socket.username=data;
    socket.snake.username=data;
    sendMessageToAll("username",{id:socket.id,username:data});
});

msgHandler.addMsgHandle("move",(socket,data)=>{
    switch(data){
        case "up":
            socket.snake.dir.x=0;
            socket.snake.dir.y=-1;
        break;
        case "down":
            socket.snake.dir.x=0;
            socket.snake.dir.y=1;
        break;
        case "left":
            socket.snake.dir.x=-1;
            socket.snake.dir.y=0;
        break;
        case "right":
            socket.snake.dir.x=1;
            socket.snake.dir.y=0;
        break;
    }
});

function update(){
    snakes.forEach(e=>e.update());
    sockets.forEach(s=>{
        sendMessage(s,"snakechange",snakes,updateReplacer);
    })
}

function getRandomSpawn(){
    return safezones[Math.floor(Math.random()*safezones.length)].getSpawnPos();
}

function collisionCheck(x,y){
    if(x<0||y<0||x>=gridsize||y>=gridsize)return null;
    if(grid[x][y]==null)return null;
    return grid[x][y].gridtype;
}

for (let x = 0; x < gridsize; x++) {
    grid[x] = [];
    for (let y = 0; y < gridsize; y++) {
        grid[x][y] = null;
    }
}

{
let stepSize = gridsize/(((safezonePerRow*safezoneScale)*2)+1);
    for (let y = 0; y < safezonePerRow; y++) {
        for (let x = 0; x < safezonePerRow; x++) {  
            let s = new SafeZone(stepSize*((x*2*safezoneScale)+(1*safezoneScale)),stepSize*((y*2*safezoneScale)+(1*safezoneScale)),stepSize);
            safezones.push(s);
        }
    }
}
let startObstacles = [];
for (let i = 0; i < obstaclecount; i++) {
    let o = new Obstacle(i);
    obstacles.push(o);
    startObstacles.push(o);
}

for (let i = 0; i < startObstacles.length; i++) {
    startObstacles[i].grow(obstaclegrow);
}

for (let i = 0; i < applecount; i++) {
    apples.push(new Apple(i));
}

const wss = new WebSocketServer.Server({ port: PORT });
setInterval(update,gameSpeed);
wss.on("connection", socket => {
    ++idCounter;
    socket.id=idCounter;

    socket.username="User"+Date.now();
    console.log(socket.username+" just connected!");
    
    let randomSpawn = getRandomSpawn();
    socket.snake = new Snake(randomSpawn.x,randomSpawn.y);
    socket.snake.id=socket.id;


    sendMessage(socket,"init",{apples:apples,snakes:snakes,obstacles:obstacles,safezones:safezones,gridSize:gridsize,id:socket.id});

    snakes.push(socket.snake);
    sockets.push(socket);
    sendMessageToAll("snakespawn",socket.snake);

    socket.on("message",data=>msgHandler.handle(socket,data));

    socket.on("close", function() {
        sendMessageToAll("snakeremove",socket.id);
        let snakeI = snakes.findIndex(s=>s==socket.snake);
        snakes[snakeI].die();
        snakes.splice(snakeI,1);
        sockets = sockets.filter(s => s !== socket);
        console.log(socket.username+" just disconnected!");
    });

});

module.exports = {sendMessage,sendMessageToAll,sendMessageToSnake};
