import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient, Role, OpportunityStatus, ApplicationStatus, RecordType, RecordStatus } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT || 4000);
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));

const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const tokenFor = user => jwt.sign({ sub:user.id, role:user.role }, process.env.JWT_SECRET, { expiresIn:'12h' });
const publicUser = u => ({ id:u.id,name:u.name,email:u.email,role:u.role,department:u.department,designation:u.designation,experienceYears:u.experienceYears,joiningDate:u.joiningDate,careerGoal:u.careerGoal,performanceScore:u.performanceScore,skills:u.skills||[] });
const auth = asyncRoute(async (req,res,next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i,'');
  if (!token) return res.status(401).json({error:'Authentication required'});
  try { const payload=jwt.verify(token,process.env.JWT_SECRET); req.user=await prisma.user.findUnique({where:{id:payload.sub},include:{skills:true}}); if(!req.user) return res.status(401).json({error:'Account not found'}); next(); }
  catch { return res.status(401).json({error:'Invalid or expired token'}); }
});
const allow = (...roles) => (req,res,next) => roles.includes(req.user.role) ? next() : res.status(403).json({error:'You do not have permission for this action'});
const idParam = z.object({id:z.string().min(1)});
const skillSchema = z.array(z.object({name:z.string().trim().min(1).max(80),level:z.number().int().min(1).max(5)})).max(50);
const opportunitySchema = z.object({title:z.string().trim().min(3).max(140),type:z.string().default('Project'),domain:z.string().min(2),department:z.string().optional(),description:z.string().min(10).max(5000),minExperience:z.number().int().min(0).max(60).default(0),duration:z.string().optional(),openPositions:z.number().int().min(1).max(100).default(1),requiredSkills:skillSchema});

app.get('/api/health', asyncRoute(async (_req,res)=>{ await prisma.$queryRaw`SELECT 1`; res.json({status:'ok',database:'connected',service:'Passage API'}); }));
app.post('/api/auth/register', asyncRoute(async(req,res)=>{
  const data=z.object({name:z.string().trim().min(2).max(100),email:z.string().email().max(254),password:z.string().min(10).max(128),role:z.nativeEnum(Role).optional(),department:z.string().optional(),designation:z.string().optional()}).parse(req.body);
  const user=await prisma.user.create({data:{...data,email:data.email.toLowerCase(),passwordHash:await bcrypt.hash(data.password,12),role:data.role||Role.EMPLOYEE},include:{skills:true}});
  res.status(201).json({token:tokenFor(user),user:publicUser(user)});
}));
app.post('/api/auth/login', asyncRoute(async(req,res)=>{
  const data=z.object({email:z.string().email(),password:z.string().min(1)}).parse(req.body);
  const user=await prisma.user.findUnique({where:{email:data.email.toLowerCase()},include:{skills:true}});
  if(!user || !(await bcrypt.compare(data.password,user.passwordHash))) return res.status(401).json({error:'Invalid email or password'});
  res.json({token:tokenFor(user),user:publicUser(user)});
}));
app.get('/api/auth/me',auth,(req,res)=>res.json({user:publicUser(req.user)}));

app.get('/api/profile',auth,asyncRoute(async(req,res)=>{ const user=await prisma.user.findUnique({where:{id:req.user.id},include:{skills:true,records:{include:{stamps:true},orderBy:{date:'desc'}},passportVersions:{orderBy:{generatedAt:'desc'}}}}); res.json({profile:publicUser(user),records:user.records,passportVersions:user.passportVersions}); }));
app.patch('/api/profile',auth,asyncRoute(async(req,res)=>{
  const data=z.object({name:z.string().min(2).max(100).optional(),department:z.string().max(100).optional(),designation:z.string().max(100).optional(),experienceYears:z.number().int().min(0).max(60).optional(),joiningDate:z.coerce.date().optional(),careerGoal:z.string().max(120).optional(),performanceScore:z.number().int().min(0).max(100).optional()}).strict().parse(req.body);
  const user=await prisma.user.update({where:{id:req.user.id},data,include:{skills:true}}); res.json({user:publicUser(user)});
}));
app.put('/api/profile/skills',auth,asyncRoute(async(req,res)=>{
  const skills=skillSchema.parse(req.body.skills);
  await prisma.$transaction([prisma.skill.deleteMany({where:{userId:req.user.id}}),prisma.skill.createMany({data:skills.map(s=>({...s,userId:req.user.id})),skipDuplicates:true})]);
  const saved=await prisma.skill.findMany({where:{userId:req.user.id}}); res.json({skills:saved});
}));

app.get('/api/opportunities',auth,asyncRoute(async(req,res)=>{
  const where={...(req.query.status?{status:req.query.status.toUpperCase()}:{}),...(req.query.domain?{domain:String(req.query.domain)}:{})};
  const items=await prisma.opportunity.findMany({where,include:{requiredSkills:true,creator:{select:{id:true,name:true,department:true}}},orderBy:{createdAt:'desc'}}); res.json({opportunities:items});
}));
app.post('/api/opportunities',auth,allow(Role.MANAGER,Role.HR),asyncRoute(async(req,res)=>{
  const data=opportunitySchema.parse(req.body);
  const item=await prisma.opportunity.create({data:{...data,creatorId:req.user.id,requiredSkills:{create:data.requiredSkills}},include:{requiredSkills:true}}); res.status(201).json({opportunity:item});
}));
app.patch('/api/opportunities/:id',auth,allow(Role.MANAGER,Role.HR),asyncRoute(async(req,res)=>{
  const {id}=idParam.parse(req.params); const data=z.object({title:z.string().min(3).optional(),description:z.string().min(10).optional(),openPositions:z.number().int().min(0).optional(),status:z.nativeEnum(OpportunityStatus).optional()}).parse(req.body);
  const item=await prisma.opportunity.update({where:{id},data,include:{requiredSkills:true}}); res.json({opportunity:item});
}));

function matchEmployee(employee, opportunity) {
  const skills=employee.skills||[]; const required=opportunity.requiredSkills||[];
  const skill=required.length?required.reduce((sum,r)=>sum+Math.min((skills.find(s=>s.name.toLowerCase()===r.name.toLowerCase())?.level||0)/r.level,1)*100,0)/required.length:100;
  const exp=opportunity.minExperience?Math.min(employee.experienceYears/opportunity.minExperience,1)*100:100;
  const goal=employee.careerGoal===opportunity.domain?100:(employee.careerGoal?40:55);
  const performance=employee.performanceScore??70; const work=100;
  const score=Math.round(skill*.5+exp*.15+goal*.15+performance*.1+work*.1);
  return {score,skill:Math.round(skill),experience:Math.round(exp),careerAlignment:Math.round(goal),performance,workload:work,reason:`${Math.round(skill)}% required-skill coverage; ${Math.round(exp)}% experience fit; ${goal===100?'career goal directly aligns':'career alignment should be reviewed'}.`};
}
app.get('/api/opportunities/:id/matches',auth,allow(Role.MANAGER,Role.HR),asyncRoute(async(req,res)=>{
  const {id}=idParam.parse(req.params); const opportunity=await prisma.opportunity.findUnique({where:{id},include:{requiredSkills:true}}); if(!opportunity)return res.status(404).json({error:'Opportunity not found'});
  const employees=await prisma.user.findMany({where:{role:Role.EMPLOYEE},include:{skills:true,records:true,applications:{where:{opportunityId:id}}}});
  const matches=employees.map(employee=>({employee:publicUser(employee),match:matchEmployee(employee,opportunity),application:employee.applications[0]||null})).sort((a,b)=>b.match.score-a.match.score); res.json({matches});
}));
app.post('/api/opportunities/:id/apply',auth,allow(Role.EMPLOYEE),asyncRoute(async(req,res)=>{
  const {id}=idParam.parse(req.params); const opportunity=await prisma.opportunity.findUnique({where:{id},include:{requiredSkills:true}}); if(!opportunity||opportunity.status!==OpportunityStatus.OPEN)return res.status(400).json({error:'Opportunity is not open'});
  const employee=await prisma.user.findUnique({where:{id:req.user.id},include:{skills:true}}); const match=matchEmployee(employee,opportunity);
  const application=await prisma.application.create({data:{employeeId:employee.id,opportunityId:id,matchScore:match.score,matchReason:match.reason}}); res.status(201).json({application});
}));
app.get('/api/applications',auth,asyncRoute(async(req,res)=>{const where=req.user.role===Role.EMPLOYEE?{employeeId:req.user.id}:{}; const applications=await prisma.application.findMany({where,include:{employee:{select:{id:true,name:true,email:true}},opportunity:true},orderBy:{appliedAt:'desc'}});res.json({applications});}));
app.patch('/api/applications/:id/status',auth,allow(Role.MANAGER,Role.HR),asyncRoute(async(req,res)=>{const {id}=idParam.parse(req.params);const status=z.nativeEnum(ApplicationStatus).parse(req.body.status);const application=await prisma.application.update({where:{id},data:{status}});res.json({application});}));
app.post('/api/assignments',auth,allow(Role.MANAGER,Role.HR),asyncRoute(async(req,res)=>{const d=z.object({employeeId:z.string(),opportunityId:z.string()}).parse(req.body);const assignment=await prisma.assignment.create({data:{...d,managerId:req.user.id},include:{employee:{select:{id:true,name:true}},opportunity:true}});await prisma.application.update({where:{employeeId_opportunityId:{employeeId:d.employeeId,opportunityId:d.opportunityId}},data:{status:ApplicationStatus.ASSIGNED}}).catch(()=>{});res.status(201).json({assignment});}));

app.get('/api/growth-records',auth,asyncRoute(async(req,res)=>{const records=await prisma.growthRecord.findMany({where:{userId:req.user.role===Role.EMPLOYEE?req.user.id:undefined},include:{stamps:true},orderBy:{date:'desc'}});res.json({records});}));
app.post('/api/growth-records',auth,asyncRoute(async(req,res)=>{const d=z.object({type:z.nativeEnum(RecordType),title:z.string().min(2).max(180),details:z.string().max(3000).optional(),date:z.coerce.date().optional(),status:z.nativeEnum(RecordStatus).default(RecordStatus.PENDING),stamps:z.array(z.object({skill:z.string().min(1),source:z.string().min(1)})).optional()}).parse(req.body);const record=await prisma.growthRecord.create({data:{...d,userId:req.user.id,stamps:{create:d.stamps||[]}},include:{stamps:true}});res.status(201).json({record});}));
app.post('/api/passport/snapshot',auth,asyncRoute(async(req,res)=>{const user=await prisma.user.findUnique({where:{id:req.user.id},include:{skills:true,records:{include:{stamps:true},orderBy:{date:'desc'}}}});const snapshot={employee:publicUser(user),records:user.records,generatedAt:new Date().toISOString()};const version=await prisma.passportVersion.create({data:{userId:user.id,snapshot}});res.status(201).json({passport:version});}));
app.get('/api/passport/versions',auth,asyncRoute(async(req,res)=>{const versions=await prisma.passportVersion.findMany({where:{userId:req.user.id},orderBy:{generatedAt:'desc'}});res.json({versions});}));

app.get('/api/hr/analytics',auth,allow(Role.HR),asyncRoute(async(_req,res)=>{
 const [employees,opportunities,applications,assignments]=await Promise.all([prisma.user.count({where:{role:Role.EMPLOYEE}}),prisma.opportunity.count(),prisma.application.count(),prisma.assignment.count()]);
 const byDepartment=await prisma.user.groupBy({by:['department'],where:{role:Role.EMPLOYEE},_count:{id:true}});
 const statusCounts=await prisma.application.groupBy({by:['status'],_count:{id:true}});
 res.json({totals:{employees,opportunities,applications,assignments},byDepartment,statusCounts});
}));
app.get('/api/hr/users',auth,allow(Role.HR),asyncRoute(async(req,res)=>{const users=await prisma.user.findMany({where:{role:Role.EMPLOYEE},include:{skills:true,records:true},orderBy:{name:'asc'}});res.json({users:users.map(publicUser)});}));
app.use((err,req,res,_next)=>{console.error(err);if(err instanceof z.ZodError)return res.status(400).json({error:'Validation failed',details:err.issues});if(err.code==='P2002')return res.status(409).json({error:'A record with this value already exists'});if(err.code==='P2025')return res.status(404).json({error:'Record not found'});res.status(500).json({error:process.env.NODE_ENV==='production'?'Internal server error':err.message});});
const server=app.listen(PORT,()=>console.log(`Passage API listening on http://localhost:${PORT}`));
process.on('SIGINT',async()=>{server.close();await prisma.$disconnect();process.exit(0);});
