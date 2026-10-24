'use strict';
function createResearchModels(mongoose){
 const {Schema}=mongoose;
 const state=new Schema({userId:{type:Schema.Types.ObjectId,unique:true,required:true,index:true},version:{type:Number,default:0},lists:{type:[Schema.Types.Mixed],default:[]},screens:{type:[Schema.Types.Mixed],default:[]},emailAlerts:{type:Boolean,default:false},emailEnabledAt:Date,transactions:{type:[Schema.Types.Mixed],default:[]},updatedAt:Date,lastSnapshotAttempt:Date});
 const snapshots=new Schema({userId:{type:Schema.Types.ObjectId,required:true,index:true},at:{type:Date,required:true},bucket:{type:Number,required:true},equity:Number,cash:Number,spy:Number,quotes:Schema.Types.Mixed,ledgerVersion:{type:Number,required:true}});
 snapshots.index({userId:1,at:-1});
 snapshots.index({userId:1,bucket:1,ledgerVersion:1},{unique:true});
 const ops=new Schema({_id:String,leaseId:String,leaseUntil:Date,lastStarted:Date,lastSuccess:Date,lastError:String,counts:Schema.Types.Mixed});
 return {ResearchAccount:mongoose.models.ResearchAccount||mongoose.model('ResearchAccount',state),PortfolioSnapshot:mongoose.models.PortfolioSnapshot||mongoose.model('PortfolioSnapshot',snapshots),WorkerHeartbeat:mongoose.models.WorkerHeartbeat||mongoose.model('WorkerHeartbeat',ops)};
}
module.exports={createResearchModels};
