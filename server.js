const WebSocketServer = require("ws")
var fs = require('fs');

let sockets = [];
const PORT = 44444;
let idCounter = 0;
let apples = [];
let obstacles = [];
let obstacleId = 0;
let snakes = [];
let safezones = [];
let lasers = [];

let grid = [];

const scoreBoardUpdateSpeed= 5000;
let leaderboard = [];

const maxusernameLength = 12;

const safezonePerRow=2;
const safezoneScale=0.5;
const gameSpeed=350;
const gridsize=100;
const obstaclecount=20;
const obstaclegrow=12;
const applecount=50;
const maxapplecount=applecount*4;

const spawnCountDownTime=3;

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
        if(x>=this.x&&y>=this.y&&x<this.x+this.size&&y<this.y+this.size)return true;
        return false;
    }
    getSpawnPos(){
        return {x:this.x+Math.floor(Math.random()*(this.size-2))+1,y:this.y+Math.floor(Math.random()*(this.size-2))+1}
    }
}

class Laser{
    x;y;
    dir={x:0,y:0};
    usedUp=false;
    constructor(x,y,dir){
        this.dir.x=dir.x;
        this.dir.y=dir.y;
        this.x=x+dir.x;
        this.y=y+dir.y;
    }
    update(){
        if(this.usedUp)return;
        if(safezoneCollision(this.x,this.y)||(this.x<0||this.y<0||this.x>=gridsize||this.y>=gridsize)){
            this.usedUp=true;
            return;
        }
        switch(collisionCheck(this.x,this.y)){
            case "Obstacle":
                this.usedUp=true;
                grid[this.x][this.y].remove();
                return;
            case "Apple":
                this.usedUp=true;
                return;
            case "Body":
                this.usedUp=true;
                return;
        }
        this.x+=this.dir.x;
        this.y+=this.dir.y;
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
        if(grid[this.x][this.y]!=null){
            console.error("illegal override:");
            console.log(grid[this.x][this.y])
        }
        grid[this.x][this.y]=this;
    }
    resetGridPos(){
        if(this.x<0||this.y<0||this.x>=gridsize||this.y>=gridsize)return;
        grid[this.x][this.y]=null;
    }
}

class Obstacle extends GridObject{
    id;
    constructor(x=null,y=null){
        super();
        this.id=++obstacleId;
        if(x==null||y==null){
            this.randomPos();
        }else{
            this.x=x;
            this.y=y;
            this.setGridPos();
        }
        this.gridtype="Obstacle";
    }
    randomPos(){
        do{
            this.x = Math.floor(Math.random()*gridsize);
            this.y = Math.floor(Math.random()*gridsize);
        }while(collisionCheck(this.x,this.y)!=null||safezoneCollision(this.x,this.y));
        this.setGridPos();
    }
    randomPosAround(){ 
        let tries=0;
        let res = {x:0,y:0};
        do{
            if(tries>4){ 
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
        }while(collisionCheck(res.x,res.y)!=null||safezoneCollision(res.x,res.y)||(res.x<0||res.y<0||res.x>=gridsize||res.y>=gridsize));
        return res;
    }
    grow(growam){
        growam--;
        if(growam<=0)return;
        for (let i = 0; i < growam; i++) {
            let res = this.randomPosAround();
            if(res==null)return;
            let obstacle = new Obstacle(res.x,res.y);
            obstacles.push(obstacle);
            obstacle.grow(growam);
        }
    }
    remove(){
        let i = obstacles.findIndex(o=>o.id==this.id);
        if(i==-1){
            console.error("tried removing non existing obstacle:"+ this);
            return;
        }
        sendMessageToAll("obstacleremove",this.id);
        this.resetGridPos();
        obstacles.splice(i,1);
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
    randomPos(){
        let oldx= this.x;
        let oldy= this.y;
        do{
            this.x = Math.floor(Math.random()*gridsize);
            this.y = Math.floor(Math.random()*gridsize);
        }while(collisionCheck(this.x,this.y)!=null||(this.x==oldx&&this.y==oldy)||safezoneCollision(this.x,this.y));
        this.setGridPos();
    }
}

class Snake {
    head;
    dir;
    username;
    state="d";
    eaten = 0;
    length = 0;
    shoot=false;
    constructor(x,y){
        this.head=new Body(x,y,this,true);
        this.dir = {x:1,y:0};
        this.state="i";
    }
    
    reset(x,y){
        this.head=new Body(x,y,this,true);
        this.dir = {x:1,y:0};
        this.state="i";
        this.eaten = 0;
        this.length = 0;
    }
    die(){
        let stoneTurned = [];
        this.state="d";
        this.head.die();
        // let droppedApples = [];
        // if(this.head.nextBody!=null&&this.head.nextBody.dropApples(droppedApples)){
        //     sendMessageToAll("appleadd",droppedApples);
        // }
        if(this.head.nextBody!=null&&this.head.nextBody.turnToStone(stoneTurned)){
            sendMessageToAll("obstacleadd",stoneTurned);
        }
    }
    moveNoSave(){
        this.head.x+=this.dir.x;
        this.head.y+=this.dir.y;
        if(this.head.x>gridsize-1||this.head.x<0||this.head.y>gridsize-1||this.head.y<0){
            sendMessageToSnake(this,"death",{cause:"you didn't see the border"});
            this.die();
            return;
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
    handleCollision(relativeX,relativeY){
        let toCollideWith = collisionCheck(this.head.x+relativeX,this.head.y+relativeY);

        switch(toCollideWith){
            case "Obstacle":
                sendMessageToSnake(this,"death",{cause:"you ran into a rock"});
                this.die();
                return true;
            case "Apple":
                let a = grid[this.head.x+relativeX][this.head.y+relativeY];
                a.resetGridPos();
                a.randomPos();
                sendMessageToAll("applechange", {id:a.id,x:a.x,y:a.y});
                this.eaten++;
                break;
            case "Body":
                let body = grid[this.head.x+relativeX][this.head.y+relativeY];
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
                return true;
        }
        return false;
    }
    update(){
        if(this.state=="d")return;

        switch(this.state){
            case "d":return; 
            case "i":       
                this.moveNoSave();       
                if(!safezoneCollision(this.head.x,this.head.y)){
                    this.state="it";
                    setTimeout(()=>this.state="itf",spawnCountDownTime*1000);
                }
                return;
            case "it":
                this.moveNoSave();
                return;
            case "itf":
                this.state="a";
                if(this.handleCollision(0,0)){
                    return;
                }
        }

        if(safezoneCollision(this.head.x+this.dir.x,this.head.y+this.dir.y)){
            sendMessageToSnake(this,"death",{cause:"you ran into the safezone"});
            this.die();
            return;
        }

        if(this.handleCollision(this.dir.x,this.dir.y)){
            return;
        };

        if(this.state=="d")return;

        if(this.eaten>this.length){
            this.length++;
            this.getTail().addBody();
        }

        this.getTail().move();
        this.move();

        if(this.shoot){
            this.shoot=false;
            let nl = new Laser(this.head.x,this.head.y,this.dir);
            lasers.push(nl);
        }
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
    addBody(){
        if(this.nextBody!=null)return;
        this.resetGridPos();
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
        this.previousBody.resetGridPos();
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
        if(this.nextBody==null||this.nextBody.nextBody==null)return false;

        if(apples.length<maxapplecount && Math.random()>0.6){
            let apple = new Apple(apples.length,this.x,this.y);
            apples.push(apple);
            collection.push(apple);
            this.nextBody.dropApples(collection);
            return true;
        }

        return this.nextBody.dropApples(collection);
    }
    turnToStone(collection){
        if(this.nextBody==null||this.nextBody.nextBody==null)return false;

        if(Math.random()>0.3){
            let obstacle = new Obstacle(this.x,this.y);
            obstacles.push(obstacle);
            collection.push(obstacle);
            this.nextBody.turnToStone(collection);
            return true;
        }

        return this.nextBody.turnToStone(collection);
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
    else if (key=="gridtype") return undefined;
    else if (key=="shoot") return undefined;
    return value;
}

function updateReplacer(key,value){
    if (key=="head") return undefined;
    else if (key=="gridtype") return undefined;
    else if (key=="snakeRef") return undefined;
    else if (key=="length") return undefined;
    else if (key=="shoot") return undefined;
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
        sendMessage(s,"msg",{usr:socket.username,msg:data});
    })
});

msgHandler.addMsgHandle("username",(socket,data)=>{
    if(data.length>maxusernameLength){
        data.length=data.slice(0,maxusernameLength);
    }
    console.log(socket.username+" is now "+ data);
    socket.username=data;
    socket.snake.username=data;
    sendMessageToAll("username",{id:socket.id,username:data});
});

msgHandler.addMsgHandle("input",(socket,data)=>{
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
        case "shoot":
            socket.snake.shoot=true;
        break;
    }
});

function updateScoreLeaderBoard(){
    if(snakes.length==0)return;
    let lb = snakes.map(s=>{
        return {username:s.username,score:s.state=="d"?0:s.eaten,id:s.id}
    });
    lb.sort((a,b)=>b.score-a.score);
    if(leaderboard.length!=lb.length){
        sendMessageToAll("lb",lb.slice(0,10));
        leaderboard=lb;
        return;
    }
    for (let i = 0; i < leaderboard.length; i++) {
        if(leaderboard[i].id!=lb[i].id||leaderboard[i].score!=lb[i].score){
            sendMessageToAll("lb",lb.slice(0,10));
            break;
        }
    }
    leaderboard=lb;
}

function update(){
    lasers.forEach(l=>l.update());
    lasers.filter(l=>!l.usedUp);
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

function safezoneCollision(x,y){
    for (let i = 0; i < safezones.length; i++) {
        if(safezones[i].checkCollision(x,y)){
            return true;
        }
    }
    return false;
}

for (let x = 0; x < gridsize; x++) {
    grid[x] = [];
    for (let y = 0; y < gridsize; y++) {
        grid[x][y] = null;
    }
}

{
    let stepSize = Math.floor(gridsize/(((safezonePerRow)*2)));
    let safeZoneSize = Math.floor(stepSize*safezoneScale);
    for (let y = 0; y < safezonePerRow; y++) {
        for (let x = 0; x < safezonePerRow; x++) {  
            let s = new SafeZone(stepSize*((x*2)+(1))-(safeZoneSize/2),stepSize*((y*2)+(1))-(safeZoneSize/2),safeZoneSize);
            safezones.push(s);
        }
    }
}
let startObstacles = [];
for (let i = 0; i < obstaclecount; i++) {
    let o = new Obstacle();
    obstacles.push(o);
    startObstacles.push(o);
}

for (let i = 0; i < startObstacles.length; i++) {
    startObstacles[i].grow(obstaclegrow);
}

for (let i = 0; i < applecount; i++) {
    apples.push(new Apple(i));
}

var cert = fs.readFileSync('../homepage/greenlock.d/live/jannik323.software/cert.pem', 'utf8');
var key = fs.readFileSync('../homepage/greenlock.d/live/jannik323.software/privkey.pem', 'utf8');
var options = {key: key, cert: cert};
var server = require('https').createServer(options);
const wss = new WebSocketServer.Server({ server: server});

server.listen(PORT,()=>{
	console.log("server started!");
	wss.on("connection", (socket,req) => {
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
});

// const wss = new WebSocketServer.Server({ port: PORT });
// console.log("server started");
// wss.on("connection", (socket,req) => {
//     ++idCounter;
//     socket.id=idCounter;
    
//         socket.username="User"+Date.now();
//         console.log(socket.username+" just connected!");
        
//         let randomSpawn = getRandomSpawn();
//         socket.snake = new Snake(randomSpawn.x,randomSpawn.y);
//         socket.snake.id=socket.id;
    
    
//         sendMessage(socket,"init",{
//             apples:apples,
//             snakes:snakes,
//             obstacles:obstacles,
//             safezones:safezones,
//             gridSize:gridsize,
//             id:socket.id,
//             spawnCountDownTime:spawnCountDownTime,
//         });
    
//         snakes.push(socket.snake);
//         sockets.push(socket);
//         sendMessageToAll("snakespawn",socket.snake);
    
//         socket.on("message",data=>msgHandler.handle(socket,data));
    
//         socket.on("close", function() {
//             sendMessageToAll("snakeremove",socket.id);
//             let snakeI = snakes.findIndex(s=>s==socket.snake);
//             snakes[snakeI].die();
//             snakes.splice(snakeI,1);
//             sockets = sockets.filter(s => s !== socket);
//             console.log(socket.username+" just disconnected!");
//         });
    
// });

setInterval(update,gameSpeed);
setInterval(updateScoreLeaderBoard,scoreBoardUpdateSpeed);
