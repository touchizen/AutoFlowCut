// Runs outside Electron's renderer. The only tree we export is the exact Flow document.
#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
static id attr(id el, NSString *key) {
  CFTypeRef out=NULL;
  if (AXUIElementCopyAttributeValue((__bridge AXUIElementRef)el,(__bridge CFStringRef)key,&out)!=kAXErrorSuccess) return nil;
  return CFBridgingRelease(out);
}
static NSString *str(id v) { return [v isKindOfClass:NSString.class] ? v : @""; }
static NSArray *kids(id el){ return attr(el,@"AXChildren") ?: @[]; }
static int budget;
static void find(id el,NSString *role,NSString *url,NSMutableArray *found,int depth) {
  if(++budget>20000 || depth>80) exit(4);
  NSString *r=attr(el,@"AXRole");
  if ([r isEqual:role] && (!url || [[[attr(el,@"AXURL") description] stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/"]] isEqual:url])) { [found addObject:el];return; }
  if ([r isEqual:@"AXWebArea"]) return;
  for (id c in kids(el)) find(c,role,url,found,depth+1);
}
static NSString *mediaKey(id el,NSString *role){
  if(![role isEqual:@"AXImage"])return @"";
  NSString *raw=[attr(el,@"AXURL") description]; if(!raw.length)return @"";
  NSURL *u=[NSURL URLWithString:raw];
  if([u.host isEqualToString:@"flow-content.google"] && [u.path hasPrefix:@"/image/"])return [@"media:" stringByAppendingString:u.lastPathComponent];
  if([raw hasPrefix:@"blob:https://flow.google.com/"])return [raw lastPathComponent];
  return @"";
}
static BOOL within(id element,id ancestor){
  for(int i=0;element&&i<40;i++,element=attr(element,@"AXParent"))
    if(CFEqual((__bridge CFTypeRef)element,(__bridge CFTypeRef)ancestor))return YES;
  return NO;
}
static id button(id scope,NSArray *names){
  NSMutableArray *items=[NSMutableArray array], *hits=[NSMutableArray array];budget=0;
  find(scope,@"AXButton",nil,items,0);
  for(id item in items)if([names containsObject:str(attr(item,@"AXTitle"))])[hits addObject:item];
  return hits.count==1?hits.firstObject:nil;
}
static NSDictionary *node(id el,int depth) {
  if(++budget>16000 || depth>80) exit(4);
  NSString *r=str(attr(el,@"AXRole")), *title=str(attr(el,@"AXTitle")), *desc=str(attr(el,@"AXDescription"));
  id v=attr(el,@"AXValue"); id frame=attr(el,@"AXFrame"); CGRect f=CGRectZero;
  if(frame && CFGetTypeID((__bridge CFTypeRef)frame)==AXValueGetTypeID()) AXValueGetValue((__bridge AXValueRef)frame,kAXValueCGRectType,&f);
  NSMutableArray *children=[NSMutableArray array];
  for(id c in kids(el)) [children addObject:node(c,depth+1)];
  return @{@"role":[r hasPrefix:@"AX"]?[r substringFromIndex:2]:r,@"name":title.length?title:desc,@"description":desc,
    @"value":str(v),@"enabled":attr(el,@"AXEnabled")?:@YES,@"focused":attr(el,@"AXFocused")?:@NO,
    @"selected":[v isKindOfClass:NSNumber.class] ? @([v boolValue]) : (attr(el,@"AXSelected") ?: NSNull.null),
    @"toggleState":[v isKindOfClass:NSNumber.class]?@([v boolValue]):NSNull.null,@"mediaKey":mediaKey(el,r),@"busy":attr(el,@"AXElementBusy")?:@NO,
    @"rect":@[@(f.origin.x),@(f.origin.y),@(f.size.width),@(f.size.height)],@"children":children};
}
static void key(pid_t pid,CGKeyCode code,CGEventFlags flags) {
  if(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier!=pid)exit(9);
  for(int down=1;down>=0;down--){CGEventRef e=CGEventCreateKeyboardEvent(NULL,code,down);CGEventSetFlags(e,flags);CGEventPost(kCGHIDEventTap,e);CFRelease(e);[NSThread sleepForTimeInterval:0.07];}
}
static BOOL mouse(id el,pid_t pid){
  id f=attr(el,@"AXFrame"); CGRect r=CGRectZero;
  if(!f||!AXValueGetValue((__bridge AXValueRef)f,kAXValueCGRectType,&r)||CGRectIsEmpty(r)
    ||NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier!=pid)return NO;
  CGPoint pt=CGPointMake(CGRectGetMidX(r),CGRectGetMidY(r));
  for(int i=0;i<2;i++){CGEventRef ev=CGEventCreateMouseEvent(NULL,i?kCGEventLeftMouseUp:kCGEventLeftMouseDown,pt,kCGMouseButtonLeft);
    CGEventPost(kCGHIDEventTap,ev);CFRelease(ev);[NSThread sleepForTimeInterval:0.07];}
  return YES;
}
static void matchingFiles(id n,NSString *name,NSMutableArray *out,int depth){
  if(++budget>16000||depth>60)exit(4);
  NSString *role=str(attr(n,@"AXRole"));
  if([role isEqual:@"AXWebArea"])return;
  if([@[@"AXImage",@"AXStaticText",@"AXTextField",@"AXCell"] containsObject:role]){
    for(NSString *key in @[@"AXTitle",@"AXDescription",@"AXValue"]){
      NSString *v=str(attr(n,key));
      if([v isEqual:name]||[v hasPrefix:[name stringByAppendingString:@", "]]){
        [out addObject:n];return;
      }
    }
  }
  for(id child in kids(n))matchingFiles(child,name,out,depth+1);
}
int main(int argc,const char **argv){@autoreleasepool{
  if(argc!=4 || !AXIsProcessTrusted()) return 2;
  pid_t pid=atoi(argv[2]); if(pid<=0)return 2;
  id app=CFBridgingRelease(AXUIElementCreateApplication(pid));
  NSString *arg=[NSString stringWithUTF8String:argv[3]];
  if(strcmp(argv[1],"snapshot")==0){
    NSMutableArray *roots=[NSMutableArray array]; find(app,@"AXWebArea",arg,roots,0);
    if(roots.count!=1)return 3; budget=0;
    NSData *data=[NSJSONSerialization dataWithJSONObject:node(roots[0],0) options:0 error:nil];
    if(!data || data.length>6000000)return 4;
    fwrite(data.bytes,1,data.length,stdout);return 0;
  }
  if(strcmp(argv[1],"open")==0){
    // Only a file open panel belonging to this process may receive the path/Return.
    id panel=attr(app,@"AXFocusedWindow"); id sheets=attr(panel,@"AXSheets");
    if([sheets count]==1)panel=[sheets firstObject];
    if(![@[@"AXSheet",@"AXWindow"] containsObject:str(attr(panel,@"AXRole"))])return 5;
    id window=panel;
    while(window && ![attr(window,@"AXRole") isEqual:@"AXWindow"])window=attr(window,@"AXParent");
    id open=button(panel,@[@"Open",@"열기"]) ?: (window?button(window,@[@"Open",@"열기"]):nil);
    if(!open || ![@[@"Open",@"열기"] containsObject:attr(open,@"AXTitle")?:@""])return 5;
    if(![attr(panel,@"AXIdentifier") isEqual:@"GoToWindow"])key(pid,5,kCGEventFlagMaskCommand|kCGEventFlagMaskShift);
    id field=nil,goSheet=nil;
    for(int i=0;i<35;i++){
      [NSThread sleepForTimeInterval:0.1];
      id sheet=attr(app,@"AXFocusedWindow");
      if(![attr(sheet,@"AXRole") isEqual:@"AXSheet"] || ![attr(sheet,@"AXIdentifier") isEqual:@"GoToWindow"])continue;
      // AppKit exposes the same sheet through both the application and the XPC
      // open panel. Never compare elements from those separate projections.
      id owner=attr(sheet,@"AXParent"); NSString *ident=str(attr(owner,@"AXIdentifier"));
      if(![ident isEqual:@"open-panel"] && ![ident isEqual:@"OpenPanel"])continue;
      NSMutableArray *fields=[NSMutableArray array];budget=0;find(sheet,@"AXTextField",nil,fields,0);
      if(fields.count==1){field=fields[0];goSheet=sheet;break;}
    }
    NSString *directory=arg.stringByDeletingLastPathComponent, *filename=arg.lastPathComponent;
    if(!field || !mouse(field,pid) || AXUIElementSetAttributeValue((__bridge AXUIElementRef)field,kAXValueAttribute,(__bridge CFStringRef)directory)!=kAXErrorSuccess)return 6;
    // AXValue changes the display, not AppKit's autocomplete model. A benign
    // edit refreshes it. No filename or path is typed into a global key event.
    key(pid,124,kCGEventFlagMaskCommand);key(pid,49,0);key(pid,51,0);
    BOOL ready=NO;
    for(int i=0;i<30;i++){
      [NSThread sleepForTimeInterval:0.1];id current=attr(app,@"AXFocusedWindow");
      if(![attr(current,@"AXIdentifier") isEqual:@"GoToWindow"])return 6;
      NSMutableArray *crumbs=[NSMutableArray array];budget=0;find(current,@"AXStaticText",nil,crumbs,0);
      for(id crumb in crumbs)if([str(attr(crumb,@"AXValue")) isEqual:directory.lastPathComponent])ready=YES;
      if(ready && [[str(attr(field,@"AXValue")) stringByStandardizingPath] isEqual:directory.stringByStandardizingPath])break;
      ready=NO;
    }
    if(!ready)return 6;key(pid,36,0);
    id chosen=nil, current=nil;
    for(int i=0;i<35;i++){
      [NSThread sleepForTimeInterval:0.1];current=attr(app,@"AXFocusedWindow");
      if(![@[@"open-panel",@"OpenPanel"] containsObject:str(attr(current,@"AXIdentifier"))])continue;
      NSMutableArray *files=[NSMutableArray array];budget=0;matchingFiles(current,filename,files,0);
      if(files.count==1){chosen=files.firstObject;break;}
    }
    if(!chosen || !mouse(chosen,pid))return 7;
    [NSThread sleepForTimeInterval:0.25];current=attr(app,@"AXFocusedWindow");
    if(![@[@"open-panel",@"OpenPanel"] containsObject:str(attr(current,@"AXIdentifier"))])return 7;
    open=button(current,@[@"Open",@"열기"]);
    if(!open||![attr(open,@"AXEnabled") boolValue])return 7;
    return AXUIElementPerformAction((__bridge AXUIElementRef)open,kAXPressAction)==kAXErrorSuccess?0:8;
  }
  return 1;
}}
