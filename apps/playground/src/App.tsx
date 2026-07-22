import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kibotalk/ui'
import PipelineSimulator from './PipelineSimulator'
import DirectApi from './DirectApi'
import LiveSession from './LiveSession'
import Enrollment from './Enrollment'

type Tab = 'pipeline' | 'direct' | 'live' | 'enroll'

export default function App() {
  const [tab, setTab] = useState<Tab>('pipeline')

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">KiboTalk 试用场</h1>
          <p className="text-sm text-muted-foreground">
            实时回复教练各能力模块的功能验证入口——不是 UI 组件库。
          </p>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="pipeline">管线模拟器</TabsTrigger>
            <TabsTrigger value="direct">直连 API</TabsTrigger>
            <TabsTrigger value="live">实时会话</TabsTrigger>
            <TabsTrigger value="enroll">声纹录入</TabsTrigger>
          </TabsList>
          <TabsContent value="pipeline">
            <PipelineSimulator />
          </TabsContent>
          <TabsContent value="direct">
            <DirectApi />
          </TabsContent>
          <TabsContent value="live">
            <LiveSession />
          </TabsContent>
          <TabsContent value="enroll">
            <Enrollment />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
