<template>
  <Dialog v-model:open="dialogOpen" :modal="false">
    <DialogContent
      class="w-[580px] pt-14 transition-none !transform-none"
      :style="style"
    >
      <div
        class="absolute flex text-center sm:text-left text-sm font-bold px-6 py-5 w-full select-none cursor-move"
        ref="dialogHeaderRef"
      >
        {{ stepTitle }} ( {{ step + 1 }} / 3 )
      </div>

      <ScrollArea class="max-h-[70dvh] w-full rounded-md">
        <section class="flex flex-col gap-3" v-if="step === 0">
          <TooltipProvider :delay-duration="0">
            <div
              class="flex flex-col border border-zinc-800 rounded-md overflow-hidden"
              v-for="(item, index) in widgetNodes"
              :key="index"
            >
              <span
                class="flex items-center justify-between p-2 text-xs bg-zinc-900 select-none"
              >
                <span class="font-bold text-zinc-400"> {{ item.title }}</span>
                <span class="text-zinc-700">id - {{ item.id }}</span>
              </span>
              <div class="flex flex-col">
                <Tooltip v-for="(widget, i) in item.widgets" :key="i">
                  <TooltipTrigger>
                    <div
                      class="flex items-center justify-between border-b border-zinc-800 p-2 last:border-b-0 hover:bg-zinc-900 hover:bg-opacity-60 transition-all"
                      @click.stop="
                        widgetSelected[`${item.id}-${i}`] =
                          !widgetSelected[`${item.id}-${i}`]
                      "
                    >
                      <Input class="w-60" v-model="widget.title" @click.stop />
                      <Switch
                        @click.stop
                        :checked="widgetSelected[`${item.id}-${i}`]"
                        @update:checked="
                          widgetSelected[`${item.id}-${i}`] = $event
                        "
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent align="start" side="right">
                    <div class="flex flex-col">
                      <span class="text-[10px] text-zinc-600">
                        当前 Value:
                      </span>
                      <span class="text-xs">{{ widget.value }}</span>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </TooltipProvider>
        </section>

        <section class="flex flex-col gap-3" v-else-if="step === 1">
          <div
            class="flex flex-col border border-zinc-800 rounded-md overflow-hidden"
            v-for="(item, index) in prompt.nodes"
            :key="index"
          >
            <span
              class="flex items-center justify-between p-2 text-xs bg-zinc-900 select-none cursor-pointer hover:bg-zinc-950 transition-all"
              @click="
                outputSelected[`${item.id}`] = !outputSelected[`${item.id}`]
              "
            >
              <span class="font-bold text-zinc-400">{{ item.title }}</span>
              <div class="flex gap-4 items-center">
                <span class="text-zinc-700">id - {{ item.id }}</span>
                <Switch
                  @click.stop
                  :checked="outputSelected[`${item.id}`]"
                  @update:checked="outputSelected[`${item.id}`] = $event"
                />
              </div>
            </span>
          </div>
        </section>
      </ScrollArea>

      <section class="flex flex-col gap-3" v-show="step === 2">
        <form class="space-y-4" @submit="onSubmit">
          <FormField name="title" v-slot="{ componentField }">
            <FormItem v-auto-animate>
              <FormControl>
                <Input
                  autofocus
                  placeholder="App 名称"
                  class="col-span-3"
                  v-bind="componentField"
                />
              </FormControl>
            </FormItem>
          </FormField>
          <FormField name="desc" v-slot="{ componentField }">
            <FormItem v-auto-animate>
              <FormControl>
                <Textarea
                  placeholder="描述 [可选]"
                  class="col-span-3"
                  v-bind="componentField"
                />
              </FormControl>
            </FormItem>
          </FormField>
        </form>
      </section>

      <DialogFooter>
        <Button
          type="submit"
          v-if="step === 1 || step === 2"
          @click="step -= 1"
        >
          上一步
        </Button>
        <Button
          type="submit"
          v-if="step === 0 || step === 1"
          @click="step += 1"
        >
          下一步
        </Button>
        <Button type="submit" v-if="step === 2" @click="onSubmit">提交</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import * as z from 'zod'
import { IComfy } from '@/types/IComfy'
import { useForm } from 'vee-validate'
import { useDraggable } from '@vueuse/core'
import { toTypedSchema } from '@vee-validate/zod'
import { FlowAppModel } from '@/database/models/app'

import { IFlow, IFlowAppData, IFlowAppInput } from '@/types/IFlow'
import { FormField, FormItem, FormControl } from '@/components/ui/form'

const props = defineProps<{
  flow: IFlow
  prompt: IComfy.AppGraphPrompt
}>()
const dialogOpen = defineModel({ type: Boolean, default: false })
const { prompt, flow } = toRefs(props)

const dialogHeaderRef = ref<HTMLElement | null>(null)

const { style, position } = useDraggable(dialogHeaderRef, {
  initialValue: {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  },
})

watch(
  dialogHeaderRef,
  (el) => {
    if (el) {
      const parent = dialogHeaderRef.value?.parentElement
      const parentRect = parent?.getBoundingClientRect()
      if (parentRect) {
        position.value = {
          x: window.innerWidth / 2 - parentRect.width / 2,
          y: window.innerHeight / 2 - parentRect.height / 2,
        }
      }
    }
  },
  { immediate: true }
)

const step = ref(0)
const stepTitle = computed(() => {
  switch (step.value) {
    case 0:
      return '选择 Widgets'
    case 1:
      return '配置 Outputs'
    case 2:
      return '生成 App'
  }
})

const nodesMap = computed(() =>
  prompt.value.nodes.reduce((acc, node) => {
    acc[node.id] = node
    return acc
  }, {} as Record<string, IComfy.AppGraphPromptNode>)
)

const widgetNodes = computed(() =>
  prompt.value.nodes.filter((node) => node.widgets.length > 0)
)
const widgetSelected = ref<{ [key: string]: boolean }>({})

const outputSelected = ref<{ [key: string]: boolean }>({})

const formSchema = toTypedSchema(
  z.object({
    title: z.string().min(2).max(50),
    desc: z.string().optional(),
  })
)

const form = useForm({
  validationSchema: formSchema,
})

const router = useRouter()
const onSubmit = form.handleSubmit(
  async (values) => {
    const title = values.title
    const description = values.desc ?? ''

    const nodeWidgetsMap = Object.entries(widgetSelected.value).reduce(
      (acc, [key, value]) => {
        const [nodeId, widgetIndex] = key.split('-').map(Number)
        if (value) {
          if (acc[nodeId]) {
            acc[nodeId].push(widgetIndex)
          } else {
            acc[nodeId] = [widgetIndex]
          }
        }
        return acc
      },
      {} as Record<number, number[]>
    )

    const nodeOutputs = Object.entries(outputSelected.value).reduce(
      (acc, [key, value]) => {
        const nodeId = key
        if (value) {
          acc.push(Number(nodeId))
        }
        return acc
      },
      [] as number[]
    )

    const inputs = []
    const outputs = []

    for (const [nodeId, widgetIndexes] of Object.entries(nodeWidgetsMap)) {
      const node = nodesMap.value[nodeId]
      for (const widgetIndex of widgetIndexes) {
        const widget = node.widgets[widgetIndex]
        inputs.push({ ...widget, nodeId: node.id })
      }
    }

    for (const nodeId of nodeOutputs) {
      outputs.push(nodesMap.value[nodeId])
    }

    const data: IComfy.AppGraphPrompt & { app: IFlowAppData } = {
      ...prompt.value,
      app: {
        title,
        description,
        inputs,
        outputs,
      },
    }

    const app = await FlowAppModel.create({
      name: title,
      description,
      flowid: flow.value.id,
      data: JSON.parse(JSON.stringify(data)),
    })

    if (app) {
      dialogOpen.value = false
      toast.success('App 创建成功')
      router.push({ name: 'FlowApp', params: { id: String(app.id) } })
    } else {
      toast.error('App 创建失败, 请重试')
    }
  },
  (e) => {
    console.log(e)
    toast.error('App 名称必须在 2 到 50 个字符之间')
  }
)

// **** 获取上次保存的 App 数据 **** //
async function getDataFromLatestApp() {
  const latestApp = await FlowAppModel.findLatestByFlowId(flow.value.id)
  if (latestApp) {
    const data =
      typeof latestApp.data === 'string'
        ? JSON.parse(latestApp.data)
        : latestApp.data
    const nodes = data.nodes as IComfy.AppGraphPromptNode[]
    const inputs = data.app.inputs as IFlowAppInput[]
    const outputs = data.app.outputs as IComfy.AppGraphPromptNode[]

    nodes.forEach((node) => {
      node.widgets.forEach((widget, index) => {
        widgetNodes.value.forEach((widgetNode) => {
          widgetNode.widgets.forEach((widgetNodeWidget) => {
            if (
              widgetNode.id === node.id &&
              widgetNodeWidget.name === widget.name
            ) {
              console.log(widget.title, widgetNodeWidget.title)
              widgetNodeWidget.title = widget.title
            }
          })
        })

        widgetSelected.value[`${node.id}-${index}`] = inputs.some(
          (input) => input.nodeId === node.id && input.name === widget.name
        )
      })
      outputSelected.value[`${node.id}`] = outputs.some(
        (output) => output.id === node.id && output.type === node.type
      )
    })
    form.setValues({
      title: data.app.title,
      desc: data.app.description,
    })
  }
}

onMounted(() => {
  getDataFromLatestApp()
})
</script>

<style lang="scss"></style>
